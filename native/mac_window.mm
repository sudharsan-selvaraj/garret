// Native macOS helper: pin an Electron window to the desktop window level so it
// floats above the wallpaper but stays behind all normal application windows —
// while remaining fully interactive (clicks + keyboard), which `type:'desktop'`
// windows do not allow. This is the core of Spike #1b.
#import <Cocoa/Cocoa.h>
#include <napi.h>

// Resolve the NSWindow from the Buffer returned by win.getNativeWindowHandle().
// On macOS that buffer holds an NSView* (the window's content view).
static NSWindow* WindowFromHandle(const Napi::Value& value) {
  if (!value.IsBuffer()) return nil;
  auto buf = value.As<Napi::Buffer<char>>();
  if (buf.Length() < sizeof(void*)) return nil;
  NSView* view = *reinterpret_cast<NSView* __unsafe_unretained*>(buf.Data());
  return view ? [view window] : nil;
}

// pinToDesktop(handleBuffer, levelOffset = 1) -> boolean
// levelOffset is added to kCGDesktopWindowLevel so we can tune stacking
// (e.g. +1 = just above wallpaper; higher to clear the desktop-icon layer).
Napi::Value PinToDesktop(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  NSWindow* window = WindowFromHandle(info[0]);
  if (!window) {
    Napi::TypeError::New(env, "valid native window handle required")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  int offset = 1;
  if (info.Length() >= 2 && info[1].IsNumber()) {
    offset = info[1].As<Napi::Number>().Int32Value();
  }

  // Run on the main UI thread to be safe.
  dispatch_block_t apply = ^{
    // Base on the desktop-ICON level (+offset). This is still far below the normal
    // window level (so we stay behind every app), but ABOVE Finder's icon window —
    // which otherwise intercepts all mouse clicks and makes the layer dead.
    window.level = CGWindowLevelForKey(kCGDesktopIconWindowLevelKey) + offset;
    window.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces |
                                NSWindowCollectionBehaviorStationary |
                                NSWindowCollectionBehaviorIgnoresCycle;
    [window setIgnoresMouseEvents:NO];
  };
  if ([NSThread isMainThread]) {
    apply();
  } else {
    dispatch_sync(dispatch_get_main_queue(), apply);
  }

  return Napi::Boolean::New(env, true);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("pinToDesktop", Napi::Function::New(env, PinToDesktop));
  return exports;
}

NODE_API_MODULE(myview_mac, Init)
