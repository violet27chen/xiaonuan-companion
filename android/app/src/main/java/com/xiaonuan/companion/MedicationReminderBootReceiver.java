package com.xiaonuan.companion;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class MedicationReminderBootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) {
            MedicationReminderScheduler.restore(context);
        }
    }
}
