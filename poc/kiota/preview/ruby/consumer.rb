require 'json'
require 'kotp_kiota_preview'
fixture=JSON.parse(File.read(ENV.fetch('POC_FIXTURE')))
observations=[]
fixture['cases'].each do |item|
  client=KOtp::Preview::Client.new(fixture['fakeSecretKey'],base_url:ENV.fetch('POC_BASE_URL'),timeout_ms:item.fetch('timeoutMs',10000))
  options={headers:{'X-Poc-Case'=>item['id']}}
  observation={'id'=>item['id']}
  begin
    observation['response']=case item['operation']
    when 'issue' then client.issue(item['request'],**options,origin:'https://poc.example.com',retry503:item['explicitRetry']==true)
    when 'verify' then client.verify(item['request'],**options)
    when 'status' then client.status(item['query']['issueId'],**options)
    when 'issues' then client.issues(item['query'],**options)
    when 'issueDetail' then client.issue_detail(item['pathValue'],**options)
    when 'creditLedger' then client.credit_ledger(item['query'],**options)
    when 'balance' then client.balance(**options)
    when 'templates' then client.templates(**options)
    when 'templateDetail' then client.template_detail(item['pathValue'],**options)
    else raise 'Unknown fixture operation'
    end
  rescue KOtp::Preview::ApiError => error
    observation.merge!('response'=>error.envelope,'status'=>error.status,'headers'=>error.headers,'requestId'=>error.request_id,'retryAfterMs'=>error.retry_after_ms)
  rescue KOtp::Preview::TransportError => error
    observation['outcome']=error.outcome
  rescue ArgumentError
    observation['outcome']='configuration_error'
  end
  observations << observation
end
File.write(ENV.fetch('POC_WIRE_RESULT'),JSON.generate(observations))
