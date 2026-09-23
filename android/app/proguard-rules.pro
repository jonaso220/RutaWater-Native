# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Add any project specific keep options here:

# react-native-device-info reads the Play install referrer on startup through
# reflection (Class.forName + getMethod). R8 would otherwise rename that API
# and the lookup would throw NoSuchMethodException on every launch.
-keep class com.android.installreferrer.api.** { *; }
