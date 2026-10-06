Gem::Specification.new do |spec|
  spec.name = 'kotp_kiota_poc'
  spec.version = '0.0.0'
  spec.summary = 'Unpublished K-OTP Kiota generated SDK fixture'
  spec.authors = ['K-OTP PoC']
  spec.license = 'MIT'
  spec.files = Dir['generated/**/*.rb']
  spec.require_paths = ['generated']
  spec.required_ruby_version = '>= 3.3.0'
  spec.add_runtime_dependency 'microsoft_kiota_abstractions', '= 0.20.0'
  spec.add_runtime_dependency 'microsoft_kiota_faraday', '= 0.20.0'
  spec.add_runtime_dependency 'microsoft_kiota_serialization_json', '= 0.20.0'
end
