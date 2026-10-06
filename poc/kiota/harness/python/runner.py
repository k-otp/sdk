"""A wheel consumer using generated builders and real Kiota HTTP/JSON runtimes."""
import asyncio
import datetime
import json
import os
import re
from uuid import UUID

import httpx
from kiota_abstractions.api_error import APIError
from kiota_abstractions.authentication.anonymous_authentication_provider import AnonymousAuthenticationProvider
from kiota_abstractions.base_request_configuration import RequestConfiguration
from kiota_http.kiota_client_factory import KiotaClientFactory
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


class LoopbackTransport(httpx.AsyncHTTPTransport):
    def __init__(self, base):
        self.allowed = httpx.URL(base)
        super().__init__(retries=0)

    async def handle_async_request(self, request):
        if (request.url.host, request.url.port, request.url.scheme) != (self.allowed.host, self.allowed.port, "http"):
            raise RuntimeError("Unexpected external network destination")
        return await super().handle_async_request(request)



def model(value, factory):
    node = JsonParseNodeFactory().get_root_parse_node("application/json", json.dumps(value, ensure_ascii=False).encode())
    return node.get_object_value(factory)


def serialize(value):
    if value is None or not hasattr(value, "serialize"):
        return None
    writer = JsonSerializationWriter()
    writer.write_object_value(None, value)
    return json.loads(writer.get_serialized_content())


async def call(client, test):
    config = RequestConfiguration()
    config.headers.add("X-Poc-Case", test["id"])
    query = test["query"]
    operation = test["operation"]
    if operation == "issue":
        raw_key = test["request"].get("idempotencyKey", "")
        key = raw_key.strip()
        if not re.fullmatch(r"[!-~]{1,128}", key):
            raise TypeError("Invalid issue idempotency key (before HTTP)")
        request = dict(test["request"])
        web_otp = request.pop("webOtp", None)
        body = model(request, IssuePostRequestBody)
        if web_otp is not None:
            wrapper = IssuePostRequestBody_webOtp()
            if isinstance(web_otp, bool): wrapper.boolean = web_otp
            else: wrapper.issue_web_otp_options = model(web_otp, IssueWebOtpOptions)
            body.web_otp = wrapper
            # Kiota 1.35 Python composed writer tests truthiness and drops false.
            # The supported AdditionalData channel preserves the exact primitive.
            if web_otp is False:
                body.web_otp = None
                body.additional_data["webOtp"] = False
        body.idempotency_key = key
        config.headers.add("Idempotency-Key", key)
        config.headers.add("Origin", "https://poc.example.com")
        return await client.issue.post(body, config)
    if operation == "verify":
        body = model(test["request"], VerifyPostRequestBody)
        return await client.verify.post(body, config)
    if operation == "status":
        config.query_parameters = StatusRequestBuilder.StatusRequestBuilderGetQueryParameters(issue_id=query["issueId"])
        return await client.status.get(config)
    if operation == "issues":
        config.query_parameters = IssuesRequestBuilder.IssuesRequestBuilderGetQueryParameters(limit=query["limit"], cursor=query.get("cursor"), verification_status=GetVerificationStatusQueryParameterType(query["verificationStatus"]))
        return await client.issues.get(config)
    if operation == "issueDetail":
        return await client.issues.by_issue_id(UUID(test["pathValue"])).get(config)
    if operation == "creditLedger":
        config.query_parameters = CreditLedgerRequestBuilder.CreditLedgerRequestBuilderGetQueryParameters(limit=query["limit"], entry_type=GetEntryTypeQueryParameterType(query["entryType"]))
        return await client.credit_ledger.get(config)
    if operation == "balance":
        return await client.balance.get(config)
    if operation == "templates":
        return await client.templates.get(config)
    if operation == "templateDetail":
        return await client.templates.by_template_id(test["pathValue"]).get(config)
    raise RuntimeError("Unknown operation")


async def main():
    fixture = json.load(open(os.environ["POC_FIXTURE"], encoding="utf-8"))
    base = os.environ["POC_BASE_URL"]
    key = fixture["fakeSecretKey"]
    if not key.startswith("sk_") or not base.startswith("http://127.0.0.1:"):
        raise TypeError("Secret key and a loopback mock URL are required")
    observations = []
    async with httpx.AsyncClient(headers={"Authorization": "Bearer " + key}, transport=LoopbackTransport(base), timeout=10) as http:
        adapter = HttpxRequestAdapter(AnonymousAuthenticationProvider(), http_client=http)
        adapter.base_url = base
        client = KOtpApiClient(adapter)
        for test in fixture["cases"]:
            observation = {"id": test["id"]}
            if test.get("defaultRetryProbe"):
                KiotaClientFactory.create_with_default_middleware(http)
            try:
                async def attempt():
                    try:
                        return await call(client, test)
                    except APIError as error:
                        if test.get("explicitRetry") and error.response_status_code == 503:
                            return await call(client, test)
                        raise
                value = await asyncio.wait_for(attempt(), timeout=test.get("timeoutMs", 10000) / 1000)
                observation["response"] = serialize(value)
            except (asyncio.TimeoutError, asyncio.CancelledError, httpx.TimeoutException) as error:
                observation.update(outcome="unknown", exception=type(error).__name__, diagnostic=str(error))
            except TypeError as error:
                observation.update(outcome="configuration_error", exception=type(error).__name__, diagnostic=str(error))
            except APIError as error:
                observation.update(response={"defined": getattr(error, "defined", None), "code": getattr(error, "code", None), "status": getattr(error, "status", None), "message": getattr(error, "message", None), "data": getattr(error, "additional_data", {}).get("data")}, status=error.response_status_code, headers=dict(error.response_headers or {}), exception=type(error).__name__, diagnostic=str(error))
            except Exception as error:
                observation.update(outcome="unexpected_exception", exception=type(error).__name__, diagnostic=str(error))
            observations.append(observation)
    with open(os.environ["POC_WIRE_RESULT"], "w", encoding="utf-8") as output:
        output.write(json.dumps(observations, ensure_ascii=False, default=lambda value: value.isoformat() if isinstance(value, (datetime.date, datetime.datetime)) else (_ for _ in ()).throw(TypeError(type(value).__name__))))


if __name__ == "__main__":
    asyncio.run(main())
