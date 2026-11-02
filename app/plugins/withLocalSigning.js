// Optional local release signing with your own key (keys/keystore.properties, kept out of
// git and the EAS upload). app.config.js only adds this plugin when that file exists.
// Use the same key as your EAS builds if local APKs should install as updates over them.
const { withAppBuildGradle } = require('expo/config-plugins');

const SIGNING = `
    signingConfigs {
        def keysFile = rootProject.file('../keys/keystore.properties')
        if (keysFile.exists()) {
            def keys = new Properties()
            keysFile.withInputStream { keys.load(it) }
            release {
                storeFile rootProject.file('../keys/' + keys['storeFile'])
                storePassword keys['storePassword']
                keyAlias keys['keyAlias']
                keyPassword keys['keyPassword']
            }
        }
    }
    buildTypes {
        release {
            if (signingConfigs.findByName('release')) signingConfig signingConfigs.release
        }
    }
    // Windows: native build paths can pass 260 characters; ANDROID_CXX_DIR moves the
    // CMake working folder somewhere short (e.g. C:/c).
    if (System.getenv('ANDROID_CXX_DIR')) {
        externalNativeBuild { cmake { buildStagingDirectory = file(System.getenv('ANDROID_CXX_DIR')) } }
    }
`;

module.exports = (config) =>
  withAppBuildGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes("keys/keystore.properties")) {
      // A second android { } block is merged by Gradle after the generated one, so it wins.
      cfg.modResults.contents += `\n// Local signing (plugins/withLocalSigning.js)\nandroid {${SIGNING}}\n`;
    }
    return cfg;
  });
