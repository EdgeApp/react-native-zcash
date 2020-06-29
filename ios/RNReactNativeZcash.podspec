
Pod::Spec.new do |s|
  s.name         = "RNReactNativeZcash"
  s.version      = "1.0.0"
  s.summary      = "Hello world, please."
  s.description  = <<-DESC
                  RNReactNativeZcash
                   DESC
  s.homepage     = "https://google.com"
  s.license      = "MIT"
  # s.license      = { :type => "MIT", :file => "FILE_LICENSE" }
  s.author             = { "author" => "author@domain.cn" }
  s.platform     = :ios, "7.0"
  s.source       = { :git => "https://github.com/author/RNReactNativeZcash.git", :tag => "master" }
  s.source_files  = "RNReactNativeZcash/**/*.{h,m}"
  s.requires_arc = true


  s.dependency "React"
  #s.dependency "others"

end

