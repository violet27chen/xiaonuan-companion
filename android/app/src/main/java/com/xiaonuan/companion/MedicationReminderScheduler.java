package com.xiaonuan.companion;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Calendar;
import java.util.HashSet;
import java.util.Set;

/** 本机每日服药提醒。无精确闹钟授权时使用系统允许的非精确闹钟。 */
public final class MedicationReminderScheduler {
    private static final String PREFS = "xiaonuan_medication_reminders";
    private static final String SCHEDULE = "schedule";
    private static final String ENABLED = "enabled";
    private static final String IDS = "ids";

    private MedicationReminderScheduler() {}

    public static boolean isEnabled(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(ENABLED, false);
    }

    public static void sync(Context context, String scheduleJson) {
        Context app = context.getApplicationContext();
        android.content.SharedPreferences prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        cancelExisting(app, prefs.getStringSet(IDS, new HashSet<>()));
        prefs.edit().putBoolean(ENABLED, true).putString(SCHEDULE, scheduleJson == null ? "[]" : scheduleJson).apply();

        Set<String> ids = new HashSet<>();
        try {
            JSONArray meds = new JSONArray(scheduleJson == null ? "[]" : scheduleJson);
            for (int i = 0; i < meds.length(); i++) {
                JSONObject med = meds.optJSONObject(i);
                if (med == null) continue;
                String name = med.optString("name", "").trim();
                String dosage = med.optString("dosage", "").trim();
                JSONArray times = med.optJSONArray("reminder_times");
                if (name.isEmpty() || times == null) continue;
                for (int j = 0; j < times.length(); j++) {
                    String time = times.optString(j, "");
                    if (!time.matches("(?:[01]\\d|2[0-3]):[0-5]\\d")) continue;
                    int id = reminderId(name, time);
                    ids.add(String.valueOf(id));
                    scheduleNext(app, id, name, dosage, time, false);
                }
            }
        } catch (Exception ignored) {}
        prefs.edit().putStringSet(IDS, ids).apply();
    }

    public static void clear(Context context) {
        Context app = context.getApplicationContext();
        android.content.SharedPreferences prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        cancelExisting(app, prefs.getStringSet(IDS, new HashSet<>()));
        prefs.edit().putBoolean(ENABLED, false).putString(SCHEDULE, "[]").putStringSet(IDS, new HashSet<>()).apply();
    }

    public static void restore(Context context) {
        android.content.SharedPreferences prefs = context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (prefs.getBoolean(ENABLED, false)) sync(context, prefs.getString(SCHEDULE, "[]"));
    }

    static void scheduleNext(Context context, int id, String name, String dosage, String time, boolean tomorrow) {
        String[] pieces = time.split(":");
        Calendar next = Calendar.getInstance();
        next.set(Calendar.HOUR_OF_DAY, Integer.parseInt(pieces[0]));
        next.set(Calendar.MINUTE, Integer.parseInt(pieces[1]));
        next.set(Calendar.SECOND, 0);
        next.set(Calendar.MILLISECOND, 0);
        if (tomorrow || !next.after(Calendar.getInstance())) next.add(Calendar.DAY_OF_YEAR, 1);

        Intent intent = new Intent(context, MedicationReminderReceiver.class);
        intent.setAction("com.xiaonuan.companion.MEDICATION_" + id);
        intent.putExtra("id", id);
        intent.putExtra("name", name);
        intent.putExtra("dosage", dosage);
        intent.putExtra("time", time);
        PendingIntent pending = PendingIntent.getBroadcast(context, id, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        AlarmManager alarm = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarm == null) return;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && alarm.canScheduleExactAlarms()) {
                alarm.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next.getTimeInMillis(), pending);
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                alarm.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next.getTimeInMillis(), pending);
            } else {
                alarm.set(AlarmManager.RTC_WAKEUP, next.getTimeInMillis(), pending);
            }
        } catch (SecurityException ignored) {
            alarm.set(AlarmManager.RTC_WAKEUP, next.getTimeInMillis(), pending);
        }
    }

    private static void cancelExisting(Context context, Set<String> ids) {
        AlarmManager alarm = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        android.app.NotificationManager notifications = (android.app.NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        for (String value : ids) {
            try {
                int id = Integer.parseInt(value);
                if (notifications != null) notifications.cancel(id);
                if (alarm == null) continue;
                Intent intent = new Intent(context, MedicationReminderReceiver.class);
                intent.setAction("com.xiaonuan.companion.MEDICATION_" + id);
                PendingIntent pending = PendingIntent.getBroadcast(context, id, intent,
                        PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE);
                if (pending != null) {
                    alarm.cancel(pending);
                    pending.cancel();
                }
            } catch (Exception ignored) {}
        }
    }

    private static int reminderId(String name, String time) {
        return 1000 + Math.floorMod((name + "@" + time).hashCode(), 1000000);
    }
}
