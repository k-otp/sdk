require 'json'
require 'uri'
require 'date'
require 'faraday'
require 'microsoft_kiota_abstractions'
require 'microsoft_kiota_serialization_json'
require 'microsoft_kiota_faraday'
require 'k_otp_api_client'
require_relative 'kotp_kiota_preview/compatibility'

module KOtp
module Preview
class ApiError < StandardError
  attr_reader :status, :envelope, :headers, :request_id, :retry_after_ms
  def initialize(error)
    @status = error.response_status_code
    @envelope = %w[defined code status message].to_h { |key| [key,error.respond_to?(key) ? error.public_send(key) : nil] }
    @envelope['data'] = error.additional_data['data'] if error.respond_to?(:additional_data)
    super(@envelope['message'] || 'K-OTP API request failed')
    @headers = (error.response_headers || {}).to_h { |key,value| [key.downcase,value.is_a?(Array) ? value : [value]] }
    @request_id = @headers.fetch('x-request-id', []).first
    data = @envelope['data'];ms = data.is_a?(Hash) ? data['retryAfterMs'] : nil
    seconds = @headers.fetch('retry-after', []).first
    @retry_after_ms = ms.is_a?(Numeric) && ms.finite? && ms>=0 ? ms : seconds && /\A[0-9]+\z/.match?(seconds) ? seconds.to_i*1000 : nil
  end
end
class TransportError < StandardError
  def outcome = 'unknown'
end
class OriginGuard < Faraday::Middleware
  def initialize(app, base, key)
    super(app);@base = base;@key = key
  end
  def call(env)
    unless [env.url.scheme,env.url.hostname,env.url.port] == [@base.scheme,@base.hostname,@base.port]
      raise ArgumentError, 'Request destination differs from the configured API origin'
    end
    env.request_headers['Authorization'] = 'Bearer '+@key
    @app.call(env)
  end
end
class Client
  def initialize(api_key, base_url: 'https://api.k-otp.dev/v1', timeout_ms: 10000)
    raise ArgumentError, 'A server secret key is required' unless api_key.is_a?(String) && /\Ask_[!-~]+\z/.match?(api_key)
    base = URI(base_url)
    unless base.userinfo.nil? && base.query.nil? && base.fragment.nil? && (base.scheme=='https' || base.scheme=='http' && base.hostname=='127.0.0.1')
      raise ArgumentError, 'An HTTPS API base URL or loopback HTTP URL is required'
    end
    raise ArgumentError, 'timeout_ms must be positive' unless timeout_ms.is_a?(Numeric) && timeout_ms.finite? && timeout_ms>0
    key = api_key.dup.freeze
    http = Faraday.new do |builder|
      builder.use OriginGuard, base, key
      builder.options.timeout = timeout_ms / 1000.0
      builder.options.open_timeout = timeout_ms / 1000.0
      builder.adapter Faraday.default_adapter
    end
    adapter = MicrosoftKiotaFaraday::FaradayRequestAdapter.new(MicrosoftKiotaAbstractions::AnonymousAuthenticationProvider.new,nil,KotpJsonWriterFactory.new,http)
    adapter.set_base_url(base.to_s);@api = KOtpSdkGenerated::KOtpApiClient.new(adapter)
  end
  def issue(input, headers: {}, origin: nil, retry503: false) = send_request('issue',input,{},'',headers,origin,retry503)
  def verify(input, headers: {}) = send_request('verify',input,{},'',headers,nil,false)
  def status(issue_id, headers: {}) = send_request('status',{}, {'issueId'=>issue_id},'',headers,nil,false)
  def issues(query = {}, headers: {}) = send_request('issues',{},query,'',headers,nil,false)
  def issue_detail(issue_id, headers: {}) = send_request('issueDetail',{}, {},issue_id,headers,nil,false)
  def credit_ledger(query = {}, headers: {}) = send_request('creditLedger',{},query,'',headers,nil,false)
  def balance(headers: {}) = send_request('balance',{}, {},'',headers,nil,false)
  def templates(headers: {}) = send_request('templates',{}, {},'',headers,nil,false)
  def template_detail(template_id, headers: {}) = send_request('templateDetail',{}, {},template_id,headers,nil,false)
  private
  def send_request(operation, input, query, path, headers, origin, retry503)
    raise ArgumentError, 'Authentication and idempotency headers are managed by the client' if headers.keys.any? { |key| %w[authorization idempotency-key].include?(key.to_s.downcase) }
    input = JSON.parse(JSON.generate(input));query = JSON.parse(JSON.generate(query));headers = headers.dup
    begin
      value = call(operation,input,query,path,headers,origin)
    rescue MicrosoftKiotaAbstractions::ApiError => error
      if operation=='issue' && retry503 && error.response_status_code==503
        value = call(operation,input,query,path,headers,origin)
      else
        raise
      end
    end
    serialize(value)
  rescue MicrosoftKiotaAbstractions::ApiError => error
    raise ApiError.new(error), cause: error
  rescue Faraday::TimeoutError, Faraday::ConnectionFailed => error
    raise TransportError.new('The request outcome is unknown'), cause: error
  end
  def model(value, type)
    MicrosoftKiotaSerializationJson::JsonParseNode.new(value).get_object_value(type.method(:create_from_discriminator_value))
  end
  def serialize(value)
    return nil unless value.respond_to?(:serialize)
    writer = KotpJsonWriter.new;writer.write_object_value(nil,value);JSON.parse(writer.get_serialized_content)
  end
def call(operation, input, query, path, headers, origin)
  config = MicrosoftKiotaAbstractions::RequestConfiguration.new
  headers.each { |name,value| config.headers.add(name.to_s,value.to_s) }
  client = @api
  case operation
  when 'issue'
    input = input.dup
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
    config.headers.add('Idempotency-Key', key);config.headers.add('Origin', origin) unless origin.nil?
    client.issue.post(body, config).resume
  when 'verify'
    client.verify.post(model(input, KOtpSdkGenerated::Verify::VerifyPostRequestBody), config).resume
  when 'status'
    params = KOtpSdkGenerated::Status::StatusRequestBuilder::StatusRequestBuilderGetQueryParameters.new
    params.issue_id = query['issueId'];config.query_parameters = params
    client.status.get(config).resume
  when 'issues'
    params = KOtpSdkGenerated::Issues::IssuesRequestBuilder::IssuesRequestBuilderGetQueryParameters.new
    params.created_from = DateTime.iso8601(query['createdFrom']) if query['createdFrom'];params.created_to = DateTime.iso8601(query['createdTo']) if query['createdTo'];params.limit = query['limit'];params.cursor = query['cursor'];params.verification_status = query['verificationStatus'];config.query_parameters = params
    client.issues.get(config).resume
  when 'issueDetail'
    client.issues.by_issue_id(path).get(config).resume
  when 'creditLedger'
    params = KOtpSdkGenerated::CreditLedger::CreditLedgerRequestBuilder::CreditLedgerRequestBuilderGetQueryParameters.new
    params.created_from = DateTime.iso8601(query['createdFrom']) if query['createdFrom'];params.created_to = DateTime.iso8601(query['createdTo']) if query['createdTo'];params.cursor = query['cursor'];params.limit = query['limit'];params.entry_type = query['entryType'];config.query_parameters = params
    client.credit_ledger.get(config).resume
  when 'balance' then client.balance.get(config).resume
  when 'templates' then client.templates.get(config).resume
  when 'templateDetail' then client.templates.by_template_id(path).get(config).resume
  else raise 'Unknown operation'
  end
end

end
end
end
