require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = package['name']
  s.version      = package['version']
  s.summary      = package['description']
  s.homepage     = package['homepage']
  s.license      = package['license']
  s.authors      = package['author']

  s.swift_version = '5.7'
  s.platform     = :ios, "13.0"
  s.requires_arc = true
  s.source       = { :git => "https://github.com/EdgeApp/react-native-zcash.git", :tag => "v#{s.version}" }
  s.source_files = "ios/**/*.{h,m,swift}"

 s.dependency "React"
 s.dependency 'ZcashLightClientKit', '0.17.0-beta'

end
