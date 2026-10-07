require 'k_otp_api_client'
require_relative 'usage'

def check(value, message)
  raise message unless value
end

node = MicrosoftKiotaSerializationJson::JsonParseNode.new({ 'name' => '모의 템플릿', 'channelSupport' => ['sms', 'alimtalk'] })
template = node.get_object_value(KOtpSdkGenerated::Models::TemplateSummary.method(:create_from_discriminator_value))
writer = KotpJsonWriter.new
writer.write_object_value(nil, template)
check(JSON.parse(writer.get_serialized_content)['channelSupport'] == ['sms', 'alimtalk'], 'enum array changed')

[false, true].each do |flag|
  body = KOtpSdkGenerated::Issue::IssuePostRequestBody.new
  union = KOtpSdkGenerated::Issue::IssuePostRequestBodyWebOtp.new
  union.boolean = flag
  body.web_otp = union
  writer = KotpJsonWriter.new
  writer.write_object_value(nil, body)
  check(JSON.parse(writer.get_serialized_content)['webOtp'] == flag, 'union scalar changed')
end

writer = KotpJsonWriter.new
payload = { 'value' => { 'leading' => '001', 'mixed' => [nil, false, 3] } }
writer.write_additional_data(payload)
check(JSON.parse(writer.get_serialized_content) == payload, 'dynamic data changed')

raised = false
begin
  MicrosoftKiotaSerializationJson::JsonParseNode.new(['sms']).get_collection_of_object_values(lambda { |node| Object.new.create_from_discriminator_value(node) })
rescue NoMethodError
  raised = true
end
check(raised, 'non-enum factory failure was swallowed')
puts 'Ruby runtime compatibility guards passed'
