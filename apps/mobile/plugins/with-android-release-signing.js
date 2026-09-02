const { withAppBuildGradle } = require('@expo/config-plugins');

module.exports = function withAndroidReleaseSigning(config) {
  return withAppBuildGradle(config, (result) => {
    if (result.modResults.language !== 'groovy') throw new Error('Android release signing plugin requires Groovy Gradle');
    let source = result.modResults.contents;
    if (source.includes('lazyArmorHasReleaseSigning')) return result;

    const variables = `
def lazyArmorKeystorePath = System.getenv('LAZY_ARMOR_ANDROID_KEYSTORE')
def lazyArmorKeystorePassword = System.getenv('LAZY_ARMOR_ANDROID_KEYSTORE_PASSWORD')
def lazyArmorKeyAlias = System.getenv('LAZY_ARMOR_ANDROID_KEY_ALIAS')
def lazyArmorKeyPassword = System.getenv('LAZY_ARMOR_ANDROID_KEY_PASSWORD')
def lazyArmorHasReleaseSigning = [lazyArmorKeystorePath, lazyArmorKeystorePassword, lazyArmorKeyAlias, lazyArmorKeyPassword].every { it != null && !it.trim().isEmpty() }
def lazyArmorAllowDebugRelease = System.getenv('LAZY_ARMOR_ANDROID_ALLOW_DEBUG_RELEASE') == 'true'
def lazyArmorAppEnv = (System.getenv('EXPO_PUBLIC_APP_ENV') ?: System.getenv('APP_ENV') ?: (System.getenv('NODE_ENV') == 'production' ? 'production' : 'development')).toLowerCase()
def lazyArmorReleaseRequested = gradle.startParameter.taskNames.any { it.toLowerCase().contains('release') }

`;
    source = source.replace(/android\s*\{/, `${variables}android {`);
    source = source.replace(
      /(signingConfigs\s*\{[\s\S]*?debug\s*\{[\s\S]*?\n\s*\})\n\s*\}/,
      `$1
        if (lazyArmorHasReleaseSigning) {
            release {
                storeFile file(lazyArmorKeystorePath)
                storePassword lazyArmorKeystorePassword
                keyAlias lazyArmorKeyAlias
                keyPassword lazyArmorKeyPassword
            }
        }
    }`,
    );
    const releasePattern = /(buildTypes\s*\{[\s\S]*?debug\s*\{[\s\S]*?signingConfig signingConfigs\.debug[\s\S]*?\}\s*release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/;
    if (!releasePattern.test(source)) throw new Error('Could not locate the Android release signingConfig');
    source = source.replace(
      releasePattern,
      `$1if (lazyArmorHasReleaseSigning) {
                signingConfig signingConfigs.release
            } else if (lazyArmorAppEnv == 'production' && lazyArmorAllowDebugRelease) {
                throw new GradleException('Production builds must never use debug signing. Remove LAZY_ARMOR_ANDROID_ALLOW_DEBUG_RELEASE or switch APP_ENV away from production.')
            } else if (lazyArmorAllowDebugRelease) {
                signingConfig signingConfigs.debug
            } else if (lazyArmorReleaseRequested) {
                throw new GradleException('Production release signing credentials are required. Set LAZY_ARMOR_ANDROID_KEYSTORE, LAZY_ARMOR_ANDROID_KEYSTORE_PASSWORD, LAZY_ARMOR_ANDROID_KEY_ALIAS, and LAZY_ARMOR_ANDROID_KEY_PASSWORD.')
            }`,
    );
    result.modResults.contents = source;
    return result;
  });
};
