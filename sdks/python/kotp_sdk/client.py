import asyncio
import datetime
import json
import re
from uuid import UUID

import httpx
from kiota_abstractions.api_error import APIError
from kiota_abstractions.authentication.anonymous_authentication_provider import AnonymousAuthenticationProvider
from kiota_abstractions.base_request_configuration import RequestConfiguration
from kiota_http.httpx_request_adapter import HttpxRequestAdapter
from kiota_serialization_json.json_parse_node_factory import JsonParseNodeFactory
from kiota_serialization_json.json_serialization_writer import JsonSerializationWriter
from kotp_sdk_generated.k_otp_api_client import KOtpApiClient
from kotp_sdk_generated.issue.issue_post_request_body import IssuePostRequestBody
from kotp_sdk_generated.issue.issue_post_request_body_web_otp import IssuePostRequestBody_webOtp
from kotp_sdk_generated.models.issue_web_otp_options import IssueWebOtpOptions
from kotp_sdk_generated.verify.verify_post_request_body import VerifyPostRequestBody
from kotp_sdk_generated.status.status_request_builder import StatusRequestBuilder
from kotp_sdk_generated.issues.issues_request_builder import IssuesRequestBuilder
from kotp_sdk_generated.issues.get_verification_status_query_parameter_type import GetVerificationStatusQueryParameterType
from kotp_sdk_generated.credit_ledger.credit_ledger_request_builder import CreditLedgerRequestBuilder
from kotp_sdk_generated.credit_ledger.get_entry_type_query_parameter_type import GetEntryTypeQueryParameterType


class KotpApiError(Exception):
    def __init__(self, error):
        self.status = error.response_status_code
        self.envelope = {"defined": getattr(error, "defined", None), "code": getattr(error, "code", None), "status": getattr(error, "status", None), "message": getattr(error, "message", None), "data": _json_tree(getattr(error, "additional_data", {}).get("data"))}
        super().__init__(self.envelope["message"] or "K-OTP API request failed")
        self.headers = {key.lower(): value if isinstance(value, list) else [value] for key, value in (error.response_headers or {}).items()}
        self.request_id = (self.headers.get("x-request-id") or [None])[0]
        data = self.envelope["data"]
        body_ms = data.get("retryAfterMs") if isinstance(data, dict) else None
        seconds = (self.headers.get("retry-after") or [""])[0]
        self.retry_after_ms = body_ms if isinstance(body_ms, (int, float)) and not isinstance(body_ms, bool) and body_ms >= 0 else int(seconds) * 1000 if str(seconds).isdigit() else None


class KotpTransportError(Exception):
    outcome = "unknown"


def _json_tree(value):
    if isinstance(value, (datetime.datetime, datetime.date)):
        return value.isoformat()
    if isinstance(value, dict):
        return {key: _json_tree(child) for key, child in value.items()}
    if isinstance(value, list):
        return [_json_tree(child) for child in value]
    return value


class _ScopedTransport(httpx.AsyncBaseTransport):
    def __init__(self, base, key, inner):
        self.base, self.key, self.inner = base, key, inner

    async def handle_async_request(self, request):
        if (request.url.scheme, request.url.host, request.url.port) != (self.base.scheme, self.base.host, self.base.port):
            raise ValueError("Request destination differs from the configured API origin")
        request.headers["Authorization"] = "Bearer " + self.key
        return await self.inner.handle_async_request(request)

    async def aclose(self):
        await self.inner.aclose()


def _model(value, factory):
    node = JsonParseNodeFactory().get_root_parse_node("application/json", json.dumps(value, ensure_ascii=False).encode())
    return node.get_object_value(factory)


def _json(value):
    if value is None:
        return None
    writer = JsonSerializationWriter()
    writer.write_object_value(None, value)
    return json.loads(writer.get_serialized_content())


def _date(value):
    return datetime.datetime.fromisoformat(value.replace("Z", "+00:00")) if value is not None else None


class KotpClient:
    def __init__(self, api_key, *, base_url="https://api.k-otp.dev/v1", timeout_ms=10000, transport=None):
        if not isinstance(api_key, str) or not re.fullmatch(r"sk_[!-~]+", api_key):
            raise TypeError("A server secret key is required")
        base = httpx.URL(base_url)
        if base.username or base.password or base.query or base.fragment or not (base.scheme == "https" or base.scheme == "http" and base.host == "127.0.0.1"):
            raise ValueError("An HTTPS API base URL or loopback HTTP URL is required")
        if not isinstance(timeout_ms, (int, float)) or timeout_ms <= 0:
            raise ValueError("timeout_ms must be positive")
        self._timeout = timeout_ms / 1000
        scoped = _ScopedTransport(base, api_key, transport or httpx.AsyncHTTPTransport(retries=0))
        self._http = httpx.AsyncClient(transport=scoped, follow_redirects=False, timeout=self._timeout)
        adapter = HttpxRequestAdapter(AnonymousAuthenticationProvider(), http_client=self._http)
        adapter.base_url = str(base)
        self._api = KOtpApiClient(adapter)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        await self.aclose()

    async def aclose(self):
        await self._http.aclose()

    def _config(self, headers):
        config = RequestConfiguration()
        for name, value in (headers or {}).items():
            if name.lower() in ("authorization", "idempotency-key"):
                raise ValueError("Authentication and idempotency headers are managed by the client")
            config.headers.add(name, value)
        return config

    async def _send(self, call, *, retry503=False):
        async def attempt():
            try:
                return await call()
            except APIError as error:
                if retry503 and error.response_status_code == 503:
                    return await call()
                raise
        try:
            return _json(await asyncio.wait_for(attempt(), timeout=self._timeout))
        except APIError as error:
            raise KotpApiError(error) from error
        except (asyncio.TimeoutError, httpx.TransportError) as error:
            raise KotpTransportError("The request outcome is unknown") from error

    async def issue(self, input, *, headers=None, origin=None, retry503=False):
        key = input.get("idempotencyKey", "")
        key = key.strip() if isinstance(key, str) else ""
        if not re.fullmatch(r"[!-~]{1,128}", key):
            raise TypeError("Invalid issue idempotency key before HTTP")
        request = dict(input)
        web = request.pop("webOtp", None)
        body = _model(request, IssuePostRequestBody)
        body.idempotency_key = key
        if web is not None:
            wrapper = IssuePostRequestBody_webOtp()
            if isinstance(web, bool):
                wrapper.boolean = web
            else:
                wrapper.issue_web_otp_options = _model(web, IssueWebOtpOptions)
            body.web_otp = wrapper
            if web is False:
                body.web_otp = None
                body.additional_data["webOtp"] = False
        config = self._config(headers)
        config.headers.add("Idempotency-Key", key)
        if origin is not None:
            config.headers.add("Origin", origin)
        return await self._send(lambda: self._api.issue.post(body, config), retry503=retry503)

    async def verify(self, input, *, headers=None):
        body, config = _model(input, VerifyPostRequestBody), self._config(headers)
        return await self._send(lambda: self._api.verify.post(body, config))

    async def status(self, issue_id, *, headers=None):
        config = self._config(headers)
        config.query_parameters = StatusRequestBuilder.StatusRequestBuilderGetQueryParameters(issue_id=issue_id)
        return await self._send(lambda: self._api.status.get(config))

    async def issues(self, query=None, *, headers=None):
        query = query or {}
        config = self._config(headers)
        value = query.get("verificationStatus")
        config.query_parameters = IssuesRequestBuilder.IssuesRequestBuilderGetQueryParameters(limit=query.get("limit"), cursor=query.get("cursor"), verification_status=GetVerificationStatusQueryParameterType(value) if value is not None else None, created_from=_date(query.get("createdFrom")), created_to=_date(query.get("createdTo")))
        return await self._send(lambda: self._api.issues.get(config))

    async def issue_detail(self, issue_id, *, headers=None):
        config, identifier = self._config(headers), UUID(issue_id)
        return await self._send(lambda: self._api.issues.by_issue_id(identifier).get(config))

    async def credit_ledger(self, query=None, *, headers=None):
        query = query or {}
        config = self._config(headers)
        value = query.get("entryType")
        config.query_parameters = CreditLedgerRequestBuilder.CreditLedgerRequestBuilderGetQueryParameters(limit=query.get("limit"), cursor=query.get("cursor"), entry_type=GetEntryTypeQueryParameterType(value) if value is not None else None, created_from=_date(query.get("createdFrom")), created_to=_date(query.get("createdTo")))
        return await self._send(lambda: self._api.credit_ledger.get(config))

    async def balance(self, *, headers=None):
        config = self._config(headers)
        return await self._send(lambda: self._api.balance.get(config))

    async def templates(self, *, headers=None):
        config = self._config(headers)
        return await self._send(lambda: self._api.templates.get(config))

    async def template_detail(self, template_id, *, headers=None):
        config = self._config(headers)
        return await self._send(lambda: self._api.templates.by_template_id(template_id).get(config))
