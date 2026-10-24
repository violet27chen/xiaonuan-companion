package com.xiaonuan.companion;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.ValueCallback;

/**
 * 陪诊小暖：WebView 壳。加载经 EdgeOne CDN 加速的小暖服务器页面，
 * 授予麦克风权限以支持网页内语音对话（录音 + 语音播报）。
 */
public class MainActivity extends Activity {

    private String siteUrl;
    private String siteHost;
    private static final int REQ_MIC = 1;
    private static final int REQ_NOTIFICATIONS = 2;
    private static final int REQ_FILE = 3;
    private static final int REQ_CAMERA_FILE = 4;
    private static final int REQ_CAMERA_VIDEO = 5;

    private WebView wv;
    private XiaonuanBridge bridge;
    private ValueCallback<Uri[]> filePathCallback;
    private PermissionRequest pendingMicRequest;
    private WebChromeClient.FileChooserParams pendingFileParams;
    private PermissionRequest pendingVideoRequest;

    // 用药提醒联动：前台时把提醒事件转发给 WebView 内的语音助手
    private static WebView sWebView;
    private static boolean sForeground = false;
    private static final String EXTRA_REMINDER_NAME = "reminder_name";
    private static final String EXTRA_REMINDER_DOSAGE = "reminder_dosage";
    private static final String EXTRA_REMINDER_TIME = "reminder_time";
    private String pendingReminderName, pendingReminderDosage, pendingReminderTime;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        siteUrl = getResources().getString(R.string.app_site_url);
        siteHost = getResources().getString(R.string.app_site_host);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        wv = new WebView(this);
        sWebView = wv;
        bridge = new XiaonuanBridge(this);
        wv.addJavascriptInterface(bridge, "XiaonuanNative");
        WebSettings s = wv.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);                       // 健康档案 localStorage
        s.setMediaPlaybackRequiresUserGesture(false);       // 允许自动播报语音
        wv.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("https".equals(uri.getScheme()) && siteHost.equals(uri.getHost())) return false;
                try {
                    Intent intent = "tel".equals(uri.getScheme())
                            ? new Intent(Intent.ACTION_DIAL, uri)
                            : new Intent(Intent.ACTION_VIEW, uri);
                    startActivity(intent);
                } catch (Exception ignored) {}
                return true;
            }
        });
        wv.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (filePathCallback != null) filePathCallback.onReceiveValue(null);
                filePathCallback = callback;
                // 拍照（capture）需要相机权限，未授权时先申请再调起相机
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP
                        && params.isCaptureEnabled()
                        && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                    pendingFileParams = params;
                    requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_CAMERA_FILE);
                    return true;
                }
                return startChooser(params);
            }

            private boolean startChooser(FileChooserParams params) {
                try {
                    startActivityForResult(params.createIntent(), REQ_FILE);
                    return true;
                } catch (Exception ignored) {
                    ValueCallback<Uri[]> cb = filePathCallback;
                    filePathCallback = null;
                    if (cb != null) cb.onReceiveValue(null);
                    return false;
                }
            }

            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        Uri origin = request.getOrigin();
                        if (origin == null || !"https".equals(origin.getScheme())
                                || !siteHost.equals(origin.getHost())) {
                            request.deny();
                            return;
                        }
                        String[] resources = request.getResources();
                        boolean needsVideo = false;
                        for (String r : resources) {
                            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) needsVideo = true;
                        }
                        if (needsVideo && checkSelfPermission(Manifest.permission.CAMERA)
                                != PackageManager.PERMISSION_GRANTED) {
                            pendingVideoRequest = request;
                            requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_CAMERA_VIDEO);
                            return;
                        }
                        request.grant(resources);
                    }
                });
            }
        });
        setContentView(wv);
        wv.loadUrl(siteUrl);
        handleIntent(getIntent());
        MedicationReminderScheduler.restore(this);
    }

    private void handleIntent(Intent intent) {
        if (intent == null) return;
        String n = intent.getStringExtra(EXTRA_REMINDER_NAME);
        if (n == null) return;
        pendingReminderName = n;
        pendingReminderDosage = intent.getStringExtra(EXTRA_REMINDER_DOSAGE);
        pendingReminderTime = intent.getStringExtra(EXTRA_REMINDER_TIME);
    }

    /** 把用药提醒事件转发给 WebView 内的语音助手（应用在前台时调用）。 */
    public static void dispatchReminder(String name, String dosage, String time) {
        if (sWebView == null || !sForeground) return;
        try {
            String json = "{\"name\":" + org.json.JSONObject.quote(name == null ? "" : name)
                    + ",\"dosage\":" + org.json.JSONObject.quote(dosage == null ? "" : dosage)
                    + ",\"time\":" + org.json.JSONObject.quote(time == null ? "" : time) + "}";
            final String js = "window.dispatchEvent(new CustomEvent('xn-medication-reminder',{detail:" + json + "}))";
            sWebView.post(() -> sWebView.evaluateJavascript(js, null));
        } catch (Exception ignored) {}
    }

    public static boolean isAppInForeground() {
        return sForeground;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_MIC && pendingMicRequest != null) {
            PermissionRequest request = pendingMicRequest;
            pendingMicRequest = null;
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED
                    && checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
            } else {
                request.deny();
            }
        }
        if (requestCode == REQ_NOTIFICATIONS && grantResults.length > 0
                && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            bridge.requestExactAlarmAccessIfNeeded();
            MedicationReminderScheduler.restore(this);
        }
        if (requestCode == REQ_CAMERA_FILE && pendingFileParams != null) {
            WebChromeClient.FileChooserParams params = pendingFileParams;
            pendingFileParams = null;
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED
                    && checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                startChooser(params);
            } else if (filePathCallback != null) {
                filePathCallback.onReceiveValue(null);
                filePathCallback = null;
            }
        }
        if (requestCode == REQ_CAMERA_VIDEO && pendingVideoRequest != null) {
            PermissionRequest req = pendingVideoRequest;
            pendingVideoRequest = null;
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED
                    && checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                req.grant(req.getResources());
            } else {
                req.deny();
            }
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_FILE && filePathCallback != null) {
            Uri[] results = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            filePathCallback.onReceiveValue(results);
            filePathCallback = null;
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        sForeground = true;
        MedicationReminderScheduler.restore(this);
        if (pendingReminderName != null) {
            String n = pendingReminderName, d = pendingReminderDosage, t = pendingReminderTime;
            pendingReminderName = pendingReminderDosage = pendingReminderTime = null;
            dispatchReminder(n, d, t);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleIntent(intent);
    }

    @Override
    public void onBackPressed() {
        if (wv != null && wv.canGoBack()) wv.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onPause() {
        sForeground = false;
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (pendingMicRequest != null) {
            pendingMicRequest.deny();
            pendingMicRequest = null;
        }
        pendingFileParams = null;
        if (pendingVideoRequest != null) {
            pendingVideoRequest.deny();
            pendingVideoRequest = null;
        }
        if (filePathCallback != null) {
            filePathCallback.onReceiveValue(null);
            filePathCallback = null;
        }
        if (wv != null) wv.destroy();
        super.onDestroy();
    }
}
