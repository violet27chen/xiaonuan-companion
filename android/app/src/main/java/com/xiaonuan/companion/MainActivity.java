package com.xiaonuan.companion;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * 陪诊小暖：WebView 壳。加载 EdgeOne 线上页面，
 * 授予麦克风权限以支持网页内语音对话（录音 + 语音播报）。
 */
public class MainActivity extends Activity {

    private static final String SITE = "https://xiaonuan.27c.site";
    private static final int REQ_MIC = 1;
    private static final int REQ_NOTIFICATIONS = 2;

    private WebView wv;
    private XiaonuanBridge bridge;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{
                    Manifest.permission.RECORD_AUDIO,
                    Manifest.permission.MODIFY_AUDIO_SETTINGS}, REQ_MIC);
        }

        wv = new WebView(this);
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
                if ("https".equals(uri.getScheme()) && "xiaonuan.27c.site".equals(uri.getHost())) return false;
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
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO)
                                == PackageManager.PERMISSION_GRANTED) {
                            request.grant(request.getResources());
                        } else {
                            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_MIC);
                            request.deny();
                        }
                    }
                });
            }
        });
        setContentView(wv);
        wv.loadUrl(SITE);
        MedicationReminderScheduler.restore(this);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_NOTIFICATIONS && grantResults.length > 0
                && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            bridge.requestExactAlarmAccessIfNeeded();
            MedicationReminderScheduler.restore(this);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        MedicationReminderScheduler.restore(this);
    }

    @Override
    public void onBackPressed() {
        if (wv != null && wv.canGoBack()) wv.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (wv != null) wv.destroy();
        super.onDestroy();
    }
}
