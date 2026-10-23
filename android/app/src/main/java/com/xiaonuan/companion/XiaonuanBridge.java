package com.xiaonuan.companion;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
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
    public void openBluetoothSettings() {
        openSystemSettings(Settings.ACTION_BLUETOOTH_SETTINGS);
    }

    @JavascriptInterface
    public void openWifiSettings() {
        openSystemSettings(Settings.ACTION_WIFI_SETTINGS);
    }

    private void openSystemSettings(String action) {
        activity.runOnUiThread(() -> {
            try {
                Intent intent = new Intent(action);
                if (intent.resolveActivity(activity.getPackageManager()) != null) {
                    activity.startActivity(intent);
                }
            } catch (Exception ignored) {}
        });
    }

    @JavascriptInterface
    public void shareText(String title, String text) {
        if (text == null || text.length() > 12000) return;
        String chooserTitle = title == null || title.isEmpty() ? "分享小暖整理的信息" : title;
        activity.runOnUiThread(() -> {
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("text/plain");
            send.putExtra(Intent.EXTRA_TEXT, text);
            activity.startActivity(Intent.createChooser(send, chooserTitle));
        });
    }

    @JavascriptInterface
    public void copyText(String text) {
        if (text == null || text.length() > 12000) return;
        activity.runOnUiThread(() -> {
            ClipboardManager clipboard = (ClipboardManager) activity.getSystemService(Activity.CLIPBOARD_SERVICE);
            if (clipboard != null) clipboard.setPrimaryClip(ClipData.newPlainText("小暖就诊摘要", text));
        });
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
