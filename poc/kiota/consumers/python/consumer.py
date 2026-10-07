import asyncio
import json
import os
from kotp_sdk import KotpClient, KotpApiError, KotpTransportError

async def main():
    with open(os.environ["POC_FIXTURE"], encoding="utf-8") as source:
        fixture = json.load(source)
    observations = []
    for case in fixture["cases"]:
        options = {"headers": {"X-Poc-Case": case["id"]}}
        observation = {"id": case["id"]}
        async with KotpClient(fixture["fakeSecretKey"], base_url=os.environ["POC_BASE_URL"], timeout_ms=case.get("timeoutMs", 10000)) as client:
            try:
                operation = case["operation"]
                if operation == "issue": value = await client.issue(case["request"], origin="https://poc.example.com", retry503=case.get("explicitRetry", False), **options)
                elif operation == "verify": value = await client.verify(case["request"], **options)
                elif operation == "status": value = await client.status(case["query"]["issueId"], **options)
                elif operation == "issues": value = await client.issues(case["query"], **options)
                elif operation == "issueDetail": value = await client.issue_detail(case["pathValue"], **options)
                elif operation == "creditLedger": value = await client.credit_ledger(case["query"], **options)
                elif operation == "balance": value = await client.balance(**options)
                elif operation == "templates": value = await client.templates(**options)
                elif operation == "templateDetail": value = await client.template_detail(case["pathValue"], **options)
                else: raise RuntimeError("Unknown fixture operation")
                observation["response"] = value
            except KotpApiError as error:
                observation.update(response=error.envelope, status=error.status, headers=error.headers, requestId=error.request_id, retryAfterMs=error.retry_after_ms)
            except KotpTransportError as error:
                observation["outcome"] = error.outcome
            except (TypeError, ValueError):
                observation["outcome"] = "configuration_error"
        observations.append(observation)
    with open(os.environ["POC_WIRE_RESULT"], "w", encoding="utf-8") as output:
        json.dump(observations, output, ensure_ascii=False)

asyncio.run(main())
