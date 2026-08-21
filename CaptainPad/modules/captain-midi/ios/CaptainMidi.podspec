require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'CaptainMidi'
  s.version        = package['version']
  s.summary        = package['description'] || 'CoreMIDI bridge for CaptainPad.'
  s.description    = package['description'] || 'CoreMIDI bridge for CaptainPad.'
  s.license        = 'MIT'
  s.author         = { 'Titanic\'s End' => 'noreply@titanicend.example' }
  s.homepage       = package['homepage'] || 'https://github.com/titanicend/BM26-Titanic'
  s.platforms      = { :ios => '15.1', :tvos => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'CoreMIDI'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = '**/*.{h,m,swift}'
end
