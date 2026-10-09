const fs = require('node:fs');
const path = require('node:path');
const {
  createRunOncePlugin,
  withAndroidManifest,
  withDangerousMod,
  withGradleProperties,
  withMainApplication,
} = require('@expo/config-plugins');

const PACKAGE_NAME = 'com.lazyarmor.app';
const BLOCKED_DEBUG_PERMISSIONS = [
  'android.permission.SYSTEM_ALERT_WINDOW',
];
const KOTLIN_FILES = [
  'AppReadForegroundService.kt',
  'AppReadSessionStore.kt',
  'ReadOnlyPageObserver.kt',
  'ArtifactShareReceipt.kt',
  'CalendarInvocationExecutor.kt',
  'DeviceAppBridgeModule.kt',
  'DeviceAppBridgePackage.kt',
  'ForegroundPackageGuard.kt',
  'GenericNotificationNormalizer.kt',
  'LazyArmorNotificationListener.kt',
  'LocalAcquisition.kt',
  'LocalCapabilityManifest.kt',
  'LazyArmorShareReceiverActivity.kt',
];

function upsertByAndroidName(items = [], value) {
  return [...items.filter((item) => item?.$?.['android:name'] !== value.$['android:name']), value];
}

function withRuntimeManifest(config) {
  return withAndroidManifest(config, (current) => {
    const manifest = current.modResults.manifest;
    const permissions = [
      ['android.permission.PACKAGE_USAGE_STATS', { 'tools:ignore': 'ProtectedPermissions' }],
      ['android.permission.FOREGROUND_SERVICE'],
      ['android.permission.FOREGROUND_SERVICE_DATA_SYNC'],
      ['android.permission.POST_NOTIFICATIONS'],
      ['android.permission.RECORD_AUDIO'],
    ];
    for (const [name, extra = {}] of permissions) {
      manifest['uses-permission'] = upsertByAndroidName(manifest['uses-permission'], {
        $: { 'android:name': name, ...extra },
      });
    }

    const queries = manifest.queries ?? [{}];
    const queryRoot = queries[0] ?? {};
    const queryIntents = queryRoot.intent ?? [];
    if (!queryIntents.some((intent) => intent?.action?.some((action) => action?.$?.['android:name'] === 'android.speech.action.RECOGNIZE_SPEECH'))) {
      queryIntents.push({ action: [{ $: { 'android:name': 'android.speech.action.RECOGNIZE_SPEECH' } }] });
    }
    queryRoot.intent = queryIntents;
    queryRoot.package = upsertByAndroidName(queryRoot.package, { $: { 'android:name': 'com.miui.calculator' } });
    queries[0] = queryRoot;
    manifest.queries = queries;

    const application = manifest.application?.[0];
    if (!application) throw new Error('Lazy Armor Android runtime requires one application manifest node');
    application.service = upsertByAndroidName(application.service, {
      $: {
        'android:name': '.LazyArmorNotificationListener',
        'android:label': '@string/app_name',
        'android:permission': 'android.permission.BIND_NOTIFICATION_LISTENER_SERVICE',
        'android:exported': 'false',
      },
      'intent-filter': [{ action: [{ $: { 'android:name': 'android.service.notification.NotificationListenerService' } }] }],
    });
    application.service = upsertByAndroidName(application.service, {
      $: {
        'android:name': '.ReadOnlyPageObserver',
        'android:label': '@string/read_only_page_observer_label',
        'android:permission': 'android.permission.BIND_ACCESSIBILITY_SERVICE',
        'android:exported': 'true',
      },
      'intent-filter': [{ action: [{ $: { 'android:name': 'android.accessibilityservice.AccessibilityService' } }] }],
      'meta-data': [{ $: { 'android:name': 'android.accessibilityservice', 'android:resource': '@xml/read_only_page_observer' } }],
    });
    application.service = upsertByAndroidName(application.service, {
      $: {
        'android:name': '.AppReadForegroundService',
        'android:exported': 'false',
        'android:foregroundServiceType': 'dataSync',
      },
    });
    application.activity = upsertByAndroidName(application.activity, {
      $: {
        'android:name': '.LazyArmorShareReceiverActivity',
        'android:exported': 'true',
        'android:noHistory': 'true',
        'android:theme': '@style/AppTheme',
      },
      'intent-filter': [{
        action: [{ $: { 'android:name': 'android.intent.action.SEND' } }, { $: { 'android:name': 'android.intent.action.SEND_MULTIPLE' } }],
        category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
        data: ['text/plain', 'text/html', 'image/*', 'application/pdf'].map(mimeType => ({ $: { 'android:mimeType': mimeType } })),
      }],
    });
    return current;
  });
}

function withRuntimePackage(config) {
  return withMainApplication(config, (current) => {
    if (current.modResults.language !== 'kt') {
      throw new Error('Lazy Armor Android runtime expects a Kotlin MainApplication');
    }
    const marker = 'PackageList(this).packages.apply {';
    if (!current.modResults.contents.includes('add(DeviceAppBridgePackage())')) {
      if (!current.modResults.contents.includes(marker)) {
        throw new Error('Unable to register DeviceAppBridgePackage in MainApplication');
      }
      current.modResults.contents = current.modResults.contents.replace(
        marker,
        `${marker}\n          // Lazy Armor allowlisted device bridge; generated by config plugin.\n          add(DeviceAppBridgePackage())`,
      );
    }
    return current;
  });
}

function withRuntimeSources(config) {
  return withDangerousMod(config, ['android', async (current) => {
    const sourceDir = path.join(__dirname, 'android-runtime');
    const targetDir = path.join(
      current.modRequest.platformProjectRoot,
      'app', 'src', 'main', 'java', ...PACKAGE_NAME.split('.'),
    );
    fs.mkdirSync(targetDir, { recursive: true });
    for (const file of KOTLIN_FILES) {
      fs.copyFileSync(path.join(sourceDir, file), path.join(targetDir, file));
    }
    const resources = path.join(current.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res');
    for (const [directory, file] of [['xml', 'read_only_page_observer.xml'], ['values', 'page_observer_strings.xml']]) {
      fs.mkdirSync(path.join(resources, directory), { recursive: true });
      fs.copyFileSync(path.join(sourceDir, file), path.join(resources, directory, file));
    }

    // Expo's debug overlays add SYSTEM_ALERT_WINDOW after the main manifest mod
    // runs. Keep app.json blockedPermissions authoritative for every build type.
    for (const sourceSet of ['debug', 'debugOptimized']) {
      const manifestPath = path.join(
        current.modRequest.platformProjectRoot,
        'app', 'src', sourceSet, 'AndroidManifest.xml',
      );
      if (!fs.existsSync(manifestPath)) continue;

      let contents = fs.readFileSync(manifestPath, 'utf8');
      for (const permission of BLOCKED_DEBUG_PERMISSIONS) {
        const escapedPermission = permission.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const declaration = new RegExp(
          `^[\\t ]*<uses-permission\\b(?=[^>]*\\bandroid:name=["']${escapedPermission}["'])[^>]*\\/>[\\t ]*\\r?\\n?`,
          'gm',
        );
        contents = contents.replace(declaration, '');
        if (contents.includes(`android:name="${permission}"`) || contents.includes(`android:name='${permission}'`)) {
          throw new Error(`Unable to remove blocked debug permission ${permission} from ${manifestPath}`);
        }
      }
      fs.writeFileSync(manifestPath, contents);
    }
    return current;
  }]);
}

function withRuntimeGradleProperties(config) {
  return withGradleProperties(config, (current) => {
    const setProperty = (key, value) => {
      current.modResults = current.modResults.filter((item) => item.key !== key);
      current.modResults.push({ type: 'property', key, value });
    };
    const jvmArgs = current.modResults.find((item) => item.key === 'org.gradle.jvmargs')?.value;
    setProperty(
      'org.gradle.jvmargs',
      typeof jvmArgs === 'string' && jvmArgs.includes('-Dfile.encoding=UTF-8')
        ? jvmArgs
        : `${jvmArgs || '-Xmx2048m -XX:MaxMetaspaceSize=512m'} -Dfile.encoding=UTF-8`,
    );
    setProperty('android.overridePathCheck', 'true');
    return current;
  });
}

function withLazyArmorAndroidRuntime(config) {
  config = withRuntimeManifest(config);
  config = withRuntimePackage(config);
  config = withRuntimeGradleProperties(config);
  config = withRuntimeSources(config);
  return config;
}

module.exports = createRunOncePlugin(
  withLazyArmorAndroidRuntime,
  'with-lazy-armor-android-runtime',
  '1.0.0',
);
