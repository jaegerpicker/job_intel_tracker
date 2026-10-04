const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  adoptSceneLifecycle,
  sceneManifest,
} = require("../plugins/withSceneLifecycle.cjs");

const source = `class AppDelegate: ExpoAppDelegate {
  var reactNativeFactory: RCTReactNativeFactory?
  func start() {
    reactNativeFactory = factory
#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}`;
test("scene owns RN start while app delegate retains factory and launch subscribers", () => {
  const result = adoptSceneLifecycle(source);
  assert.match(result, /ExpoReactNativeFactoryProvider/);
  assert.doesNotMatch(result, /factory.startReactNative/);
  assert.match(result, /reactNativeFactory = factory/);
  assert.match(result, /return super.application/);
  assert.equal(adoptSceneLifecycle(result), result);
});
test("unknown templates fail closed instead of generating a broken signed app", () => {
  assert.throws(
    () => adoptSceneLifecycle("class DifferentAppDelegate {}"),
    /template changed/,
  );
});
test("manifest selects the SDK's Objective-C scene delegate and one window", () => {
  const manifest = sceneManifest();
  assert.equal(manifest.UIApplicationSupportsMultipleScenes, false);
  assert.equal(
    manifest.UISceneConfigurations.UIWindowSceneSessionRoleApplication[0]
      .UISceneDelegateClassName,
    "EXExpoAppSceneDelegate",
  );
});
