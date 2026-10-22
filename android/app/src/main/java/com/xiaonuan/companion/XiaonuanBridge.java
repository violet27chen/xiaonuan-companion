package com.xiaonuan.companion;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.webkit.JavascriptInterface;

public class XiaonuanBridge {
    private final Activity activity;
    private static final int REQUEST_NOTIFICATIONS = 2;

    XiaonuanBridge(Activity activity) {
        this.activity = activity;
    }

    @JavascriptInterface
    public boolean areMedicationRemindersEnabled() {
        return MedicationReminderScheduler.isEnabled(activity);
    }

    @JavascriptInterface
    public void setMedicationReminders(String json) {
        activity.runOnUiThread(() -> MedicationReminderScheduler.sync(activity, json));
    }

    @JavascriptInterface
    public void clearMedicationReminders() {
        activity.runOnUiThread(() -> MedicationReminderScheduler.clear(activity));
    }

    @JavascriptInterface
    public void requestNotificationPermission() {
        activity.runOnUiThread(() -> {
            if (Build.VERSION.SDK_INT >= 33
                    && activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                activity.requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQUEST_NOTIFICATIONS);
            } else {
                requestExactAlarmAccessIfNeeded();
            }
        });
    }

    void requestExactAlarmAccessIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            android.app.AlarmManager alarm = (android.app.AlarmManager) activity.getSystemService(Activity.ALARM_SERVICE);
            if (alarm != null && !alarm.canScheduleExactAlarms()) {
                try {
                    Intent intent = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                            Uri.parse("package:" + activity.getPackageName()));
                    activity.startActivity(intent);
                } catch (Exception ignored) {}
            }
        }
    }
}
