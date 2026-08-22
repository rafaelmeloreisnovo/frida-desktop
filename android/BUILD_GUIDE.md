# Frida Desktop Android APK Build Guide

**Status:** Gradle configuration complete | SDK not available in this environment

---

## Environment Setup

This remote environment does not include the Android SDK. To compile the APK, you need:

### Required Tools
- **Android Studio 2023.1+** or **Android SDK Command-line Tools**
- **JDK 11+** (included in Android Studio or available separately)
- **Gradle 8.1+** (included via Android Studio or gradle wrapper)
- **NDK r25+** (for native .so compilation)

### Installation Steps (on your local machine or Android dev machine)

#### Option 1: Using Android Studio (Recommended)
```bash
# Install Android Studio from https://developer.android.com/studio
# Open the project:
cd frida-desktop/android
# Android Studio will auto-detect gradle and SDK requirements
# File → Open → select android/ directory
# Let Android Studio download any missing components
```

#### Option 2: Using Command-line Tools
```bash
# 1. Download Android SDK command-line tools
# https://developer.android.com/studio#command-tools

# 2. Set up environment
export ANDROID_HOME=$HOME/Android/Sdk
export PATH=$ANDROID_HOME/cmdline-tools/latest/bin:$PATH
export PATH=$ANDROID_HOME/platform-tools:$PATH
export JAVA_HOME=/usr/lib/jvm/java-11-openjdk  # or your JDK path

# 3. Accept SDK licenses
sdkmanager --licenses

# 4. Install required SDK components
sdkmanager "platforms;android-34"
sdkmanager "build-tools;34.0.0"
sdkmanager "ndk;25.2.9519653"
```

---

## Build Configuration

### Project Structure
```
android/
├── app/                          # Main app module
│   ├── src/
│   │   └── io/rafaelia/fridalab/
│   │       ├── ui/               # UI components
│   │       │   └── ResearchModePanel.java
│   │       └── learning/         # RFL learning layer
│   │           ├── RFLBridge.java (JNI wrapper)
│   │           └── MetricsPoller.java
│   ├── native/                   # C/Native code
│   │   ├── learning_runtime.c
│   │   ├── learning_store.c
│   │   └── neon4096_core.c
│   ├── AndroidManifest.xml
│   ├── build.gradle              # ✅ Created
│   └── proguard-rules.pro         # ✅ Created
├── settings.gradle               # ✅ Created
├── build.gradle                  # ✅ Created
├── gradle.properties             # ✅ Created
└── BUILD_GUIDE.md               # This file
```

### Gradle Configuration (Already Set Up)

**app/build.gradle:**
- `compileSdk 34` (Android 14)
- `minSdk 29` (Android 10)
- `targetSdk 34` (Android 14)
- ABI Filters: armeabi-v7a, arm64-v8a
- Java 11 compatibility
- ProGuard enabled (release builds)

**Dependencies:**
- androidx.appcompat:1.6.1
- androidx.constraintlayout:2.1.4
- com.google.android.material:1.10.0
- com.google.code.gson:2.10.1
- com.squareup.okhttp3:4.11.0

---

## Building the APK

### Debug Build (Fast, for testing)
```bash
cd frida-desktop/android

# Using gradle directly
gradle :app:assembleDebug

# Or using gradle wrapper (when available)
./gradlew :app:assembleDebug

# Output: app/build/outputs/apk/debug/app-debug.apk
```

### Release Build (Signed, for distribution)
```bash
# First, create a keystore (one-time)
keytool -genkey -v -keystore ~/.android/release.keystore \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -alias frida-release

# Then build
gradle :app:assembleRelease

# Output: app/build/outputs/apk/release/app-release.apk
```

### Custom Build (with specific configuration)
```bash
# Build with debug symbols
gradle :app:assembleDebug -x test

# Build specific variant
gradle :app:assembleDebug --build-cache

# Build with verbose output (troubleshooting)
gradle :app:assembleDebug -i
```

---

## Installation & Testing

### Install on Device
```bash
# Prerequisites: Device connected via USB with USB debugging enabled
adb devices

# Install debug APK
adb install -r app/build/outputs/apk/debug/app-debug.apk

# Uninstall
adb uninstall io.rafaelia.fridalab

# View logs
adb logcat | grep "fridalab\|RFL\|Learning"
```

### Launch Application
```bash
# Start activity
adb shell am start -n io.rafaelia.fridalab/.MainActivity

# View running processes
adb shell ps | grep fridalab

# Get app info
adb shell dumpsys package io.rafaelia.fridalab
```

### Native Code Testing
```bash
# Verify .so files are packaged
unzip -l app/build/outputs/apk/debug/app-debug.apk | grep "\.so"

# Expected output:
# lib/armeabi-v7a/librfl_bridge.so
# lib/arm64-v8a/librfl_bridge.so
```

---

## NDK Build Configuration

### Native Module Setup (C/Native)
```bash
# Create Android.mk if not present
# Location: android/app/native/Android.mk

LOCAL_PATH := $(call my-dir)

include $(CLEAR_VARS)
LOCAL_MODULE := rfl_bridge
LOCAL_SRC_FILES := learning_runtime.c learning_store.c neon4096_core.c
LOCAL_C_INCLUDES := $(LOCAL_PATH)
LOCAL_LDLIBS := -llog -landroid
include $(BUILD_SHARED_LIBRARY)
```

### Build Native Code
```bash
# If using NDK build system
ndk-build -C android/app/native/

# Or let Gradle handle it automatically
# (requires cmake or Android.mk in app/src/main/cpp/)
```

---

## Troubleshooting

### Common Issues

**1. "SDK location not found"**
```bash
# Create local.properties
echo "sdk.dir=$ANDROID_HOME" > android/local.properties
```

**2. "Gradle sync failed"**
```bash
# Clean build
gradle clean
gradle build --refresh-dependencies
```

**3. "NDK not found"**
```bash
# Install NDK via sdkmanager
sdkmanager "ndk;25.2.9519653"

# Update gradle.properties
echo "ndk.dir=$ANDROID_HOME/ndk/25.2.9519653" >> gradle.properties
```

**4. "Compilation fails with Java version error"**
```bash
# Ensure Java 11+ is installed
java -version

# Set JAVA_HOME if needed
export JAVA_HOME=/usr/lib/jvm/java-11-openjdk
```

**5. "Resources not found (R class)"**
```bash
# Clean and rebuild
gradle clean
gradle :app:assembleDebug
```

---

## Build Output

After successful build, check:

```bash
# Debug APK (for testing)
ls -lh app/build/outputs/apk/debug/app-debug.apk

# Build artifacts
tree app/build/outputs/

# Expected structure:
# app/build/outputs/
# ├── apk/
# │   ├── debug/
# │   │   └── app-debug.apk          (~5-10 MB)
# │   └── release/
# │       └── app-release.apk        (~4-8 MB after ProGuard)
# └── bundle/
#     └── release/
#         └── app-release.aab        (Google Play format)
```

---

## APK Contents Verification

```bash
# Inspect APK structure
unzip -l app/build/outputs/apk/debug/app-debug.apk | grep -E "\.so|\.class|AndroidManifest"

# Extract and inspect
unzip -d /tmp/apk_extracted app/build/outputs/apk/debug/app-debug.apk

# Check package info
aapt dump badging app/build/outputs/apk/debug/app-debug.apk
```

---

## Continuous Integration

### GitHub Actions Example
```yaml
# .github/workflows/android-build.yml
name: Android Build

on: [push, pull_request]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-java@v3
        with:
          java-version: '11'
      - name: Build APK
        run: |
          cd android
          gradle :app:assembleDebug
      - name: Upload APK
        uses: actions/upload-artifact@v3
        with:
          name: app-debug.apk
          path: android/app/build/outputs/apk/debug/
```

---

## Next Steps

1. **Set up Android SDK** on your development machine
2. **Run build command**: `gradle :app:assembleDebug`
3. **Test on device**: `adb install app/build/outputs/apk/debug/app-debug.apk`
4. **Launch app**: `adb shell am start -n io.rafaelia.fridalab/.MainActivity`
5. **Monitor logs**: `adb logcat | grep fridalab`

---

## Support Files

- **AndroidManifest.xml** - App configuration and permissions
- **build.gradle** - Build configuration ✅
- **gradle.properties** - Build properties ✅
- **proguard-rules.pro** - Code obfuscation ✅
- **Java source files** - UI and RFL bridge ✅
- **Native code** - C/NEON implementation ✅

**Status: Ready to build on Android SDK-equipped machine**

---

**Configuration Date:** 2026-08-22  
**Gradle Version:** 8.1+  
**Target SDK:** Android 14 (API 34)
