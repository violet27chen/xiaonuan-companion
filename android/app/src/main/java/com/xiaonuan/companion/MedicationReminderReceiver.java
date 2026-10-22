package com.xiaonuan.companion;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

public class MedicationReminderReceiver extends BroadcastReceiver {
    private static final String CHANNEL_ID = "xiaonuan_medication";

    @Override
    public void onReceive(Context context, Intent intent) {
        int id = intent.getIntExtra("id", 0);
        String name = intent.getStringExtra("name");
        String dosage = intent.getStringExtra("dosage");
        String time = intent.getStringExtra("time");
        if (name == null || time == null || !MedicationReminderScheduler.isEnabled(context)) return;

        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "小暖用药提醒", NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("按您设置的时间提醒服药");
            manager.createNotificationChannel(channel);
        }
        Intent open = new Intent(context, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent content = PendingIntent.getActivity(context, id, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        String body = "到服药时间了：" + name + (dosage == null || dosage.isEmpty() ? "" : "，" + dosage) + "。请按医生交代服用。";
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(context, CHANNEL_ID)
                : new Notification.Builder(context);
        builder.setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle("小暖用药提醒 · " + time)
                .setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setContentIntent(content)
                .setAutoCancel(true)
                .setDefaults(Notification.DEFAULT_ALL)
                .setCategory(Notification.CATEGORY_REMINDER)
                .setPriority(Notification.PRIORITY_HIGH);
        try {
            manager.notify(id, builder.build());
        } catch (SecurityException ignored) {}

        MedicationReminderScheduler.scheduleNext(context, id, name, dosage == null ? "" : dosage, time, true);
    }
}
