const { withAppDelegate, withInfoPlist } = require("expo/config-plugins");

// Expo 57's native template still starts RN in UIApplicationDelegate. UIKit 27
// traps that lifecycle. Use the SDK's scene delegate and factory-provider bridge.
function adoptSceneLifecycle(source) {
  const declaration = "class AppDelegate: ExpoAppDelegate {";
  const adopted =
    "class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {";
  if (source.includes(adopted) && !source.includes("factory.startReactNative("))
    return source;
  const legacyStart =
    /#if os\(iOS\) \|\| os\(tvOS\)\s+window = UIWindow\(frame: UIScreen\.main\.bounds\)\s+factory\.startReactNative\([\s\S]*?launchOptions: launchOptions\)\s*#endif/;
  if (!source.includes(declaration) || !legacyStart.test(source)) {
    throw new Error(
      "Expo AppDelegate template changed; review scene lifecycle before building.",
    );
  }
  return source
    .replace(declaration, adopted)
    .replace(
      legacyStart,
      "// ExpoAppSceneDelegate creates the window and starts React Native.",
    );
}

function sceneManifest() {
  return {
    UIApplicationSupportsMultipleScenes: false,
    UISceneConfigurations: {
      UIWindowSceneSessionRoleApplication: [
        {
          UISceneConfigurationName: "Default Configuration",
          UISceneDelegateClassName: "EXExpoAppSceneDelegate",
        },
      ],
    },
  };
}

module.exports = function withSceneLifecycle(config) {
  config = withInfoPlist(config, (mod) => {
    mod.modResults.UIApplicationSceneManifest = sceneManifest();
    return mod;
  });
  return withAppDelegate(config, (mod) => {
    if (mod.modResults.language !== "swift")
      throw new Error("Scene lifecycle requires the reviewed Swift template.");
    mod.modResults.contents = adoptSceneLifecycle(mod.modResults.contents);
    return mod;
  });
};
module.exports.adoptSceneLifecycle = adoptSceneLifecycle;
module.exports.sceneManifest = sceneManifest;
