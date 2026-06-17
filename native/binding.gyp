{
  "targets": [
    {
      "target_name": "garret_mac",
      "conditions": [
        [
          "OS=='mac'",
          {
            "sources": ["mac_window.mm"],
            "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
            "libraries": ["-framework Cocoa", "-framework CoreGraphics"],
            "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
            "xcode_settings": {
              "OTHER_CPLUSPLUSFLAGS": ["-ObjC++", "-std=c++17"],
              "CLANG_CXX_LIBRARY": "libc++",
              "CLANG_ENABLE_OBJC_ARC": "YES",
              "MACOSX_DEPLOYMENT_TARGET": "10.15"
            }
          }
        ]
      ]
    }
  ]
}
