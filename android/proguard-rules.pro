# This is a configuration file for ProGuard.
# http://proguard.sourceforge.net/index.html#manual/usage.html

-dontpreverify
-verbose

# Preserve line numbers for debugging stack traces
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Keep all classes in RFL and learning packages
-keep class io.rafaelia.fridalab.learning.** { *; }
-keep class io.rafaelia.fridalab.ui.** { *; }

# Keep native methods
-keepclasseswithmembernames class * {
    native <methods>;
}

# Keep activity and service classes
-keep public class * extends android.app.Activity
-keep public class * extends android.app.Service
-keep public class * extends android.content.BroadcastReceiver
-keep public class * extends android.content.ContentProvider

# Keep R class members
-keepclassmembers class **.R$* {
    public static <fields>;
}

# Keep Parcelable implementations
-keep class * implements android.os.Parcelable {
    public static final android.os.Parcelable$Creator *;
}

# Keep GSON-serialized classes
-keepclasseswithmembers class * {
    @com.google.gson.annotations.SerializedName <fields>;
}
