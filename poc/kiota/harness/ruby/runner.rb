require 'json'
require 'uri'
require 'faraday'
require 'microsoft_kiota_abstractions'
require 'microsoft_kiota_serialization_json'
require 'microsoft_kiota_faraday'
require_relative 'generated/k_otp_api_client'

def model(value, type)
  MicrosoftKiotaSerializationJson::JsonParseNode.new(value).get_object_value(type.method(:create_from_discriminator_value))
end
def serialize(value)
  return nil unless value.respond_to?(:serialize)
  writer = MicrosoftKiotaSerializationJson::JsonSerializationWriter.new
  writer.write_object_value(nil, value)
  JSON.parse(writer.get_serialized_content)
end
def call(client, test)
  config = MicrosoftKiotaAbstractions::RequestConfiguration.new
  config.headers.add('X-Poc-Case', test['id'])
  case test['operation']
  when 'issue'
    input = test['request'].dup
    key = (input['idempotencyKey'] || '').strip
    raise ArgumentError, 'Invalid idempotency before HTTP' unless /\A[!-~]{1,128}\z/.match?(key)
    web = input.delete('webOtp')
    body = model(input, KOtpSdkGenerated::Issue::IssuePostRequestBody)
    body.idempotency_key = key
    unless web.nil?
      wrapper = KOtpSdkGenerated::Issue::IssuePostRequestBodyWebOtp.new
      if web == true || web == false then wrapper.boolean = web
      else wrapper.issue_web_otp_options = model(web, KOtpSdkGenerated::Models::IssueWebOtpOptions) end
      body.web_otp = wrapper
    end
    config.headers.add('Idempotency-Key', key);config.headers.add('Origin', 'https://poc.example.com')
    client.issue.post(body, config).resume
  when 'verify'
    client.verify.post(model(test['request'], KOtpSdkGenerated::Verify::VerifyPostRequestBody), config).resume
  when 'status'
    params = KOtpSdkGenerated::Status::StatusRequestBuilder::StatusRequestBuilderGetQueryParameters.new
    params.issue_id = test['query']['issueId'];config.query_parameters = params
    client.status.get(config).resume
  when 'issues'
    params = KOtpSdkGenerated::Issues::IssuesRequestBuilder::IssuesRequestBuilderGetQueryParameters.new
    params.limit = test['query']['limit'];params.cursor = test['query']['cursor'];params.verification_status = test['query']['verificationStatus'];config.query_parameters = params
    client.issues.get(config).resume
  when 'issueDetail'
    client.issues.by_issue_id(test['pathValue']).get(config).resume
  when 'creditLedger'
    params = KOtpSdkGenerated::CreditLedger::CreditLedgerRequestBuilder::CreditLedgerRequestBuilderGetQueryParameters.new
    params.limit = test['query']['limit'];params.entry_type = test['query']['entryType'];config.query_parameters = params
    client.credit_ledger.get(config).resume
  when 'balance' then client.balance.get(config).resume
  when 'templates' then client.templates.get(config).resume
  when 'templateDetail' then client.templates.by_template_id(test['pathValue']).get(config).resume
  else raise 'Unknown operation'
  end
end

fixture = JSON.parse(File.read(ENV.fetch('POC_FIXTURE')))
base = URI(ENV.fetch('POC_BASE_URL'));key = fixture['fakeSecretKey']
raise ArgumentError unless base.hostname == '127.0.0.1' && key.start_with?('sk_')
observations = []
fixture['cases'].each do |test|
  http = Faraday.new(headers: {'Authorization' => 'Bearer ' + key}) do |builder|
    builder.options.timeout = (test['timeoutMs'] || 10000) / 1000.0
    builder.adapter Faraday.default_adapter
  end
  adapter = MicrosoftKiotaFaraday::FaradayRequestAdapter.new(MicrosoftKiotaAbstractions::AnonymousAuthenticationProvider.new, nil, nil, http)
  adapter.set_base_url(base.to_s);client = KOtpSdkGenerated::KOtpApiClient.new(adapter)
  observation = {'id' => test['id']}
  begin
    value = call(client, test)
    observation['response'] = serialize(value)
  rescue ArgumentError => error
    observation['outcome'] = 'configuration_error';observation['exception'] = error.class.name
  rescue StandardError => error
    observation['outcome'] = test['timeoutMs'] ? 'unknown' : 'unexpected_exception'
    observation['exception'] = error.class.name;observation['diagnostic'] = error.message
    observation['response'] = serialize(error) if error.respond_to?(:serialize)
  end
  observations << observation
end
File.write(ENV.fetch('POC_WIRE_RESULT'), JSON.generate(observations))
