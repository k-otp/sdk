require 'json'
require 'microsoft_kiota_serialization_json'

# Only repair the invalid enum-Hash factory emitted for enum arrays. Other
# factory failures still propagate through the official parser and fail tests.
module KotpEnumArrayCompatibility
  def get_collection_of_object_values(factory)
    wrapped = lambda do |node|
      begin
        factory.call(node)
      rescue NoMethodError => error
        receiver = error.receiver
        unless error.name == :create_from_discriminator_value && receiver.is_a?(Hash) &&
            receiver.values.all? { |value| value.is_a?(Symbol) || value.is_a?(String) }
          raise
        end
        node.get_enum_value(receiver)
      end
    end
    super(wrapped)
  end
end
MicrosoftKiotaSerializationJson::JsonParseNode.prepend(KotpEnumArrayCompatibility)

class KotpJsonWriter < MicrosoftKiotaSerializationJson::JsonSerializationWriter
  # This mapping is derived from the generation input, never from HTTP fixtures.
  ENUM_WIRE_VALUES = JSON.parse(File.read(File.join(__dir__, 'enum-wire-values.json'))).freeze

  def write_enum_value(key, value)
    return if value.nil?
    super(key, ENUM_WIRE_VALUES.fetch(value.to_s, value.to_s))
  end

  def write_collection_of_object_values(key, values)
    if values && values.all? { |value| value.is_a?(Symbol) }
      return write_collection_of_enum_values(key, values.map { |value| ENUM_WIRE_VALUES.fetch(value.to_s, value.to_s) })
    end
    super
  end

  def write_any_value(key, value)
    if value.is_a?(Hash) || value == false
      return set_root_value(value) if key.nil?
      @writer[key] = value
    else
      super
    end
  end

  private

  def object_value_hash(value, *additional_values_to_merge)
    temp = self.class.new
    value.serialize(temp)
    additional_values_to_merge.each { |item| item&.serialize(temp) }
    temp.root_value? ? temp.root_value : temp.writer
  end
end

class KotpJsonWriterFactory < MicrosoftKiotaSerializationJson::JsonSerializationWriterFactory
  def get_serialization_writer(content_type)
    raise ArgumentError, 'Invalid JSON content type' unless content_type.split(';').first.strip.downcase == get_valid_content_type
    KotpJsonWriter.new
  end
end
