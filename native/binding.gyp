{
  "targets": [
    {
      "target_name": "myview_mac",
      "conditions": [
        [
          "OS=='mac'",
          {
            "sources": ["mac_window.mm"],
            "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
            "libraries": ["-framework Cocoa"],
            "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
            "xcode_settings": {
              "OTHER_CPLUSPLUSFLAGS": ["-ObjC++", "-std=c++17"],
              "CLANG_CXX_LIBRARY": "libc++",
              "MACOSX_DEPLOYMENT_TARGET": "10.15"
            }
          }
        ]
      ]
    }
  ]
}
