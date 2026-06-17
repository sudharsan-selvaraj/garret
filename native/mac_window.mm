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

// raiseToHud(handleBuffer) -> boolean
// Float the window ABOVE everything — including full-screen apps in their own
// Spaces — and activate the app so it receives keyboard (Esc) input.
Napi::Value RaiseToHud(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  NSWindow* window = WindowFromHandle(info[0]);
  if (!window) {
    Napi::TypeError::New(env, "valid native window handle required")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  // NOTE: do NOT set window.level here — Electron owns it via setAlwaysOnTop.
  // We only set the collection behavior so it floats over full-screen Spaces,
  // and order it front WITHOUT activating the app (activation forces a Space
  // switch / process-type transform that makes the HUD flicker out over
  // full-screen apps). Dismiss is via hotkey / backdrop click.
  dispatch_block_t apply = ^{
    // Set the high level here too so it AGREES with Electron's setAlwaysOnTop
    // (matching values → neither clobbers the other).
    window.level = CGWindowLevelForKey(kCGScreenSaverWindowLevelKey);
    window.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces |
                                NSWindowCollectionBehaviorFullScreenAuxiliary |
                                NSWindowCollectionBehaviorStationary;
    [window setIgnoresMouseEvents:NO];
    [window orderFrontRegardless];
  };
  if ([NSThread isMainThread]) {
    apply();
  } else {
    dispatch_sync(dispatch_get_main_queue(), apply);
  }
  return Napi::Boolean::New(env, true);
}

// makePanel(handleBuffer) -> boolean
// Turn the window into a non-activating panel. Non-activating panels are the one
// kind of window macOS lets float over another app's full-screen Space without
// stealing activation or being flapped hidden — the fix for HUD-over-full-screen.
Napi::Value MakePanel(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  NSWindow* window = WindowFromHandle(info[0]);
  if (!window) {
    Napi::TypeError::New(env, "valid native window handle required")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  dispatch_block_t apply = ^{
    window.styleMask |= NSWindowStyleMaskNonactivatingPanel;
  };
  if ([NSThread isMainThread]) {
    apply();
  } else {
    dispatch_sync(dispatch_get_main_queue(), apply);
  }
  return Napi::Boolean::New(env, true);
}

// ---- Clipboard manager helpers ---------------------------------------------

// The app that was frontmost when the clipboard picker was summoned. We restore
// focus to it before synthesizing ⌘V so the paste lands in the right window.
static NSRunningApplication* gPrevApp = nil;

// pasteboardChangeCount() -> number
// Cheap monotonically-increasing counter; lets us poll without reading content.
Napi::Value PasteboardChangeCount(const Napi::CallbackInfo& info) {
  return Napi::Number::New(info.Env(), (double)[[NSPasteboard generalPasteboard] changeCount]);
}

// pasteboardIsConcealed() -> boolean
// True if the current item is flagged confidential/transient (password managers
// set these so clipboard managers skip them).
Napi::Value PasteboardIsConcealed(const Napi::CallbackInfo& info) {
  NSArray<NSString*>* types = [[NSPasteboard generalPasteboard] types];
  for (NSString* t in types) {
    if ([t isEqualToString:@"org.nspasteboard.ConcealedType"] ||
        [t isEqualToString:@"org.nspasteboard.TransientType"] ||
        [t isEqualToString:@"org.nspasteboard.AutoGeneratedType"]) {
      return Napi::Boolean::New(info.Env(), true);
    }
  }
  return Napi::Boolean::New(info.Env(), false);
}

// pasteboardFileURLs() -> string[]
// File-system paths currently on the pasteboard (empty if none).
Napi::Value PasteboardFileURLs(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  NSPasteboard* pb = [NSPasteboard generalPasteboard];
  NSArray* urls = [pb readObjectsForClasses:@[ [NSURL class] ]
                                    options:@{ NSPasteboardURLReadingFileURLsOnlyKey : @YES }];
  Napi::Array out = Napi::Array::New(env);
  uint32_t n = 0;
  for (NSURL* url in urls) {
    if (url.isFileURL && url.path) out.Set(n++, Napi::String::New(env, url.path.UTF8String));
  }
  return out;
}

// writeFileURLs(paths: string[]) -> boolean — put file references on the pasteboard.
Napi::Value WriteFileURLs(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsArray()) return Napi::Boolean::New(env, false);
  Napi::Array arr = info[0].As<Napi::Array>();
  NSMutableArray* urls = [NSMutableArray array];
  for (uint32_t i = 0; i < arr.Length(); i++) {
    Napi::Value v = arr.Get(i);
    if (!v.IsString()) continue;
    NSString* p = [NSString stringWithUTF8String:v.As<Napi::String>().Utf8Value().c_str()];
    [urls addObject:[NSURL fileURLWithPath:p]];
  }
  if (urls.count == 0) return Napi::Boolean::New(env, false);
  dispatch_block_t apply = ^{
    NSPasteboard* pb = [NSPasteboard generalPasteboard];
    [pb clearContents];
    [pb writeObjects:urls];
  };
  if ([NSThread isMainThread]) apply();
  else dispatch_sync(dispatch_get_main_queue(), apply);
  return Napi::Boolean::New(env, true);
}

// frontmostAppName() -> string — localized name of the frontmost app (or '').
Napi::Value FrontmostAppName(const Napi::CallbackInfo& info) {
  NSRunningApplication* app = [[NSWorkspace sharedWorkspace] frontmostApplication];
  NSString* name = app.localizedName ?: @"";
  return Napi::String::New(info.Env(), name.UTF8String);
}

// rememberFrontmostApp() -> boolean — capture the app to restore focus to on paste.
Napi::Value RememberFrontmostApp(const Napi::CallbackInfo& info) {
  gPrevApp = [[NSWorkspace sharedWorkspace] frontmostApplication];
  return Napi::Boolean::New(info.Env(), gPrevApp != nil);
}

// pasteToPreviousApp() -> boolean
// Re-activate the remembered app and synthesize ⌘V into it. Requires Accessibility
// permission (synthetic events are silently dropped without it).
Napi::Value PasteToPreviousApp(const Napi::CallbackInfo& info) {
  NSRunningApplication* target = gPrevApp;
  dispatch_block_t apply = ^{
    if (target) [target activateWithOptions:NSApplicationActivateIgnoringOtherApps];
    // Give activation a beat to land before posting the keystroke.
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.06 * NSEC_PER_SEC)),
                   dispatch_get_main_queue(), ^{
      CGEventSourceRef src = CGEventSourceCreate(kCGEventSourceStateCombinedSessionState);
      const CGKeyCode kVK_V = 9;
      CGEventRef down = CGEventCreateKeyboardEvent(src, kVK_V, true);
      CGEventSetFlags(down, kCGEventFlagMaskCommand);
      CGEventRef up = CGEventCreateKeyboardEvent(src, kVK_V, false);
      CGEventSetFlags(up, kCGEventFlagMaskCommand);
      CGEventPost(kCGHIDEventTap, down);
      CGEventPost(kCGHIDEventTap, up);
      if (down) CFRelease(down);
      if (up) CFRelease(up);
      if (src) CFRelease(src);
    });
  };
  if ([NSThread isMainThread]) apply();
  else dispatch_sync(dispatch_get_main_queue(), apply);
  return Napi::Boolean::New(info.Env(), true);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("pinToDesktop", Napi::Function::New(env, PinToDesktop));
  exports.Set("raiseToHud", Napi::Function::New(env, RaiseToHud));
  exports.Set("makePanel", Napi::Function::New(env, MakePanel));
  exports.Set("pasteboardChangeCount", Napi::Function::New(env, PasteboardChangeCount));
  exports.Set("pasteboardIsConcealed", Napi::Function::New(env, PasteboardIsConcealed));
  exports.Set("pasteboardFileURLs", Napi::Function::New(env, PasteboardFileURLs));
  exports.Set("writeFileURLs", Napi::Function::New(env, WriteFileURLs));
  exports.Set("frontmostAppName", Napi::Function::New(env, FrontmostAppName));
  exports.Set("rememberFrontmostApp", Napi::Function::New(env, RememberFrontmostApp));
  exports.Set("pasteToPreviousApp", Napi::Function::New(env, PasteToPreviousApp));
  return exports;
}

NODE_API_MODULE(garret_mac, Init)
