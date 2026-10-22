package com.xiaonuan.companion;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.Dialog;
import android.content.ContentValues;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.util.Base64;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.view.inputmethod.InputMethodManager;
import android.content.Context;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.Locale;
import java.util.UUID;

/** 原生版小暖：原生 Android 界面，直接调用现有服务，不再通过 WebView 加载网页。 */
public class MainActivity extends Activity {
    private static final String API = "https://xiaonuan.27c.site/companion";
    private static final int REQ_MIC = 41;
    private static final int REQ_PHOTO = 42;
    private static final int REQ_CAMERA = 43;
    private static final int TEAL = Color.rgb(39, 119, 119);
    private static final int INK = Color.rgb(34, 61, 64);
    private static final int MUTED = Color.rgb(110, 137, 137);
    private static final int BG = Color.rgb(244, 248, 246);
    private SharedPreferences prefs;
    private LinearLayout root, messages;
    private ScrollView chatScroll;
    private EditText input;
    private Button sendButton, micButton;
    private TextView status;
    private ProgressBar progress;
    private SpeechRecognizer recognizer;
    private TextToSpeech tts;
    private boolean speakingReady;
    private boolean busy;
    private boolean captionsLarge;
    private boolean speakerEnabled=true;
    private JSONObject latestCard;
    private String pendingText = "";
    private String pendingReminderJson = "[]";
    private JSONArray medications = new JSONArray();
    private JSONObject recordsSnapshot = new JSONObject();
    private Uri cameraUri;
    private Dialog photoDialog;
    private LinearLayout photoContent;
    private ProgressBar photoProgress;
    private CheckBox photoConsent, otherInfoConsent;
    private JSONObject photoResult;
    private final java.util.ArrayList<PhotoDraft> photoDrafts = new java.util.ArrayList<>();
    private XiaonuanView mascot;
    private TextView companionHint;

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setStatusBarColor(BG);
        getWindow().setNavigationBarColor(Color.WHITE);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        prefs = getSharedPreferences("xiaonuan_native", MODE_PRIVATE);
        captionsLarge=prefs.getBoolean("captions_large",false);
        tts = new TextToSpeech(this, result -> {
            if (result == TextToSpeech.SUCCESS) {
                tts.setLanguage(Locale.SIMPLIFIED_CHINESE);
                tts.setSpeechRate(prefs.getBoolean("slow", true) ? 0.82f : 1.0f);
                tts.setOnUtteranceProgressListener(new UtteranceProgressListener(){
                    @Override public void onStart(String id){runOnUiThread(()->{if(mascot!=null)mascot.setMood(XiaonuanView.Mood.SPEAKING);if(companionHint!=null)companionHint.setText("小暖正在说话…");});}
                    @Override public void onDone(String id){runOnUiThread(()->setCompanionIdle());}
                    @Override public void onError(String id){runOnUiThread(()->setCompanionIdle());}
                });
                speakingReady = true;
            }
        });
        if (token().isEmpty()) showAuth(); else showChat();
    }

    private void showAuth() {
        root = page();
        LinearLayout box = column();
        box.setPadding(dp(26), dp(28), dp(26), dp(28));
        box.setBackground(round(Color.WHITE, 28));
        TextView title = text("小暖", 30, INK, true);
        TextView sub = text("陪您把就医信息说清楚、记明白", 15, MUTED, false);
        EditText user = field("用户名");
        EditText pass = field("密码"); pass.setInputType(129);
        EditText pass2 = field("再次输入密码"); pass2.setInputType(129); pass2.setVisibility(View.GONE);
        TextView error = text("", 13, Color.rgb(183, 83, 65), false);
        Button submit = button("登录并继续", TEAL);
        Button swap = button("没有账号？创建账号", Color.rgb(234, 243, 240)); swap.setTextColor(TEAL);
        final boolean[] register = {false};
        swap.setOnClickListener(v -> {
            register[0] = !register[0]; pass2.setVisibility(register[0] ? View.VISIBLE : View.GONE);
            submit.setText(register[0] ? "创建账号" : "登录并继续");
            swap.setText(register[0] ? "已有账号？返回登录" : "没有账号？创建账号"); error.setText("");
        });
        submit.setOnClickListener(v -> {
            String name = user.getText().toString().trim(), pw = pass.getText().toString();
            if (name.isEmpty() || pw.isEmpty()) { error.setText("请填写用户名和密码"); return; }
            if (register[0] && pw.length() < 8) { error.setText("密码至少需要8位"); return; }
            if (register[0] && !pw.equals(pass2.getText().toString())) { error.setText("两次密码不一致"); return; }
            setBusy(true, submit, "正在连接…");
            new Thread(() -> {
                try {
                    JSONObject result = request(register[0] ? "register" : "login", new JSONObject().put("username", name).put("password", pw), false);
                    prefs.edit().putString("token", result.getString("token")).putString("user", result.optString("username", name))
                            .putString("cid", result.optString("cid", newCid())).apply();
                    runOnUiThread(this::showChat);
                } catch (Exception e) { runOnUiThread(() -> { error.setText(friendly(e)); submit.setEnabled(true); submit.setText(register[0] ? "创建账号" : "登录并继续"); }); }
            }).start();
        });
        add(box, title, 0, 0, 0, 4); add(box, sub, 0, 0, 0, 18); add(box, user, 0, 0, 0, 10);
        add(box, pass, 0, 0, 0, 10); add(box, pass2, 0, 0, 0, 8); add(box, error, 0, 0, 0, 8);
        add(box, submit, 0, 0, 0, 8); add(box, swap, 0, 0, 0, 0);
        TextView safety = text("健康记录仅供整理和核对，不替代医生意见。", 12, MUTED, false); safety.setGravity(Gravity.CENTER);
        root.addView(box, new LinearLayout.LayoutParams(-1, -2)); add(root, safety, 0, 18, 0, 0);
        setContentView(root);
    }

    private void showChat() {
        root = page();
        LinearLayout header = row(); header.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout brand = column();
        add(brand, text("小暖  ·  就医助手", 19, INK, true), 0, 0, 0, 2);
        add(brand, text("把就医信息说清楚、记明白", 12, MUTED, false), 0, 0, 0, 0);
        Button records = smallButton("我的记录"); records.setOnClickListener(v -> openRecords());
        header.addView(brand, new LinearLayout.LayoutParams(0, -2, 1)); header.addView(records);
        add(root, header, 18, 10, 18, 10);
        LinearLayout topLine = row(); topLine.setGravity(Gravity.CENTER_VERTICAL);
        status = text("自动识别 · 日常聊天", 12, MUTED, false); topLine.addView(status, new LinearLayout.LayoutParams(0, -2, 1));
        Button mode = smallButton("模式"); mode.setOnClickListener(v -> new AlertDialog.Builder(this).setTitle("选择聊天方式")
                .setItems(new String[]{"自动识别", "就诊前准备", "就诊后整理", "日常聊天"}, (d, which) -> {
                    String[] values = {"auto", "pre", "post", "chat"}; prefs.edit().putString("mode", values[which]).apply();
                    status.setText(new String[]{"自动识别", "就诊前准备", "就诊后整理", "日常聊天"}[which]);
                }).show());
        topLine.addView(mode); add(root, topLine, 18, 0, 18, 6);
        LinearLayout character = new LinearLayout(this);character.setGravity(Gravity.CENTER_VERTICAL);character.setPadding(dp(8),0,dp(8),0);
        mascot=new XiaonuanView(this);character.addView(mascot,new LinearLayout.LayoutParams(dp(136),dp(152)));
        companionHint=text("您好，我在听。您可以直接说说想做什么。",15,INK,false);companionHint.setPadding(dp(12),dp(12),dp(12),dp(12));companionHint.setBackground(round(Color.WHITE,18));
        character.addView(companionHint,new LinearLayout.LayoutParams(0,-2,1));add(root,character,10,0,10,2);
        chatScroll = new ScrollView(this); chatScroll.setFillViewport(true);
        messages = column(); messages.setPadding(dp(16), dp(12), dp(16), dp(16)); chatScroll.addView(messages);
        root.addView(chatScroll, new LinearLayout.LayoutParams(-1, 0, 1));
        addBubble("小暖", "您好，我是小暖。您可以直接说说今天想聊什么；需要看药盒或医嘱时，也可以把照片发给我。", false);
        progress = new ProgressBar(this); progress.setVisibility(View.GONE); add(root, progress, 0, 0, 0, 4);
        LinearLayout tools = row(); tools.setGravity(Gravity.CENTER_VERTICAL);
        Button photo = smallButton("拍药盒/医嘱"); photo.setOnClickListener(v -> choosePhoto());
        Button slow = smallButton(prefs.getBoolean("slow", true) ? "慢速朗读" : "自然语速");
        slow.setOnClickListener(v -> { boolean next = !prefs.getBoolean("slow", true); prefs.edit().putBoolean("slow", next).apply(); slow.setText(next ? "慢速朗读" : "自然语速"); if (tts != null) tts.setSpeechRate(next ? .82f : 1f); });
        Button repeat = smallButton("再听一次"); repeat.setOnClickListener(v -> { if (!pendingText.isEmpty()) speak(pendingText); });
        Button captions=smallButton(captionsLarge?"字幕已放大":"字幕放大");captions.setOnClickListener(v->{captionsLarge=!captionsLarge;prefs.edit().putBoolean("captions_large",captionsLarge).apply();captions.setText(captionsLarge?"字幕已放大":"字幕放大");});
        Button speaker=smallButton(speakerEnabled?"语音已开":"语音已关");speaker.setOnClickListener(v->{speakerEnabled=!speakerEnabled;speaker.setText(speakerEnabled?"语音已开":"语音已关");if(!speakerEnabled&&tts!=null)tts.stop();});
        tools.addView(photo); tools.addView(slow); tools.addView(captions); tools.addView(repeat); tools.addView(speaker); add(root, tools, 12, 4, 12, 6);
        LinearLayout composer = row(); composer.setGravity(Gravity.CENTER_VERTICAL);
        input = new EditText(this); input.setHint("说说您的情况…"); input.setTextSize(16); input.setSingleLine(false); input.setMaxLines(3);
        input.setPadding(dp(15), dp(10), dp(12), dp(10)); input.setBackground(round(Color.WHITE, 20));
        micButton = button("🎙", Color.rgb(230, 242, 238)); micButton.setTextColor(TEAL); micButton.setOnClickListener(v -> startListening());
        sendButton = button("发送", TEAL); sendButton.setOnClickListener(v -> sendText());
        composer.addView(micButton, new LinearLayout.LayoutParams(dp(54), dp(52)));
        LinearLayout.LayoutParams ip = new LinearLayout.LayoutParams(0, -2, 1); ip.setMargins(dp(8), 0, dp(8), 0); composer.addView(input, ip);
        composer.addView(sendButton, new LinearLayout.LayoutParams(dp(72), dp(52)));
        add(root, composer, 12, 0, 12, 8);
        add(root, text("聊天记录和健康记录按账号保存；小暖不会替代医生诊断。", 11, MUTED, false), 16, 0, 16, 8);
        setContentView(root);
        if(!prefs.getBoolean("native_activated_once",false))showActivationDialog();
    }

    private void sendText() {
        String text = input.getText().toString().trim(); if (text.isEmpty() || busy) return;
        input.setText(""); ((InputMethodManager)getSystemService(INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(input.getWindowToken(), 0);
        handleInput(text);
    }

    private void handleInput(String text){
        addBubble("您",text,true);
        String t=text.replaceAll("[，。！？、,.!?\\s]","");String reply=null;
        if(t.matches(".*(拍照|照张|药盒照片|医嘱照片|拍一下|看看这个药).*")){reply="我打开拍照入口了，您可以拍药盒或医嘱给我看。";addBubble("小暖",reply,false);pendingText=reply;speak(reply);choosePhoto();return;}
        if(t.matches(".*(放大字幕|字幕大一点|字幕放大).*")){captionsLarge=true;prefs.edit().putBoolean("captions_large",true).apply();reply="字幕已经放大。";}
        else if(t.matches(".*(字幕恢复|字幕小一点|关闭大字幕).*")){captionsLarge=false;prefs.edit().putBoolean("captions_large",false).apply();reply="字幕已经恢复。";}
        else if(t.matches(".*(说慢点|慢一点|慢速朗读).*")){prefs.edit().putBoolean("slow",true).apply();if(tts!=null)tts.setSpeechRate(.82f);reply="好，我会说慢一点。";}
        else if(t.matches(".*(自然语速|说快点|正常语速).*")){prefs.edit().putBoolean("slow",false).apply();if(tts!=null)tts.setSpeechRate(1f);reply="好，我会用自然语速说话。";}
        else if(t.matches(".*(再听一次|再说一遍|重复刚才).*")){if(!pendingText.isEmpty()){speak(pendingText);return;}reply="还没有可以重听的内容。";}
        else if(t.matches(".*(打开记录|查看记录|我的记忆|健康档案|用药记录).*")){reply="我打开您的记录了。";addBubble("小暖",reply,false);pendingText=reply;speak(reply);openRecords();return;}
        else if(t.matches(".*(就诊前|看诊前|准备看医生).*")){prefs.edit().putString("mode","pre").apply();if(status!=null)status.setText("就诊前准备");reply="已经切到就诊前准备。";}
        else if(t.matches(".*(就诊后|看诊后|整理医嘱).*")){prefs.edit().putString("mode","post").apply();if(status!=null)status.setText("就诊后整理");reply="已经切到就诊后整理。";}
        else if(t.matches(".*(自动模式|自动识别).*")){prefs.edit().putString("mode","auto").apply();if(status!=null)status.setText("自动识别");reply="已经切回自动识别模式。";}
        else if(t.matches(".*(关闭语音|不要读出来|静音).*")){speakerEnabled=false;reply="好的，我先关闭语音。";}
        else if(t.matches(".*(打开语音|开启语音|读出来).*")){speakerEnabled=true;reply="好的，我会用语音回答。";}
        if(reply!=null){addBubble("小暖",reply,false);pendingText=reply;speak(reply);return;}
        ask(text);
    }

    private void ask(String message) {
        setBusy(true, sendButton, "…"); progress.setVisibility(View.VISIBLE);
        setCompanionMood(XiaonuanView.Mood.THINKING,"小暖正在想怎么回答…");
        TextView answer = addBubble("小暖", "正在听您说…", false);
        new Thread(() -> {
            try {
                JSONObject body = new JSONObject().put("message", message).put("mode", prefs.getString("mode", "auto")).put("token", token());
                String answerText = requestSse(body);
                String finalAnswer = answerText.trim().isEmpty() ? "这次没有听清楚，请您再说一遍。" : answerText.trim();
                runOnUiThread(() -> { answer.setText(finalAnswer); pendingText = finalAnswer; companionHint.setText(finalAnswer); speak(finalAnswer); refreshRecordsQuietly(); });
            } catch (Exception e) { runOnUiThread(() -> {answer.setText(friendly(e));setCompanionIdle();}); }
            finally { runOnUiThread(() -> { setBusy(false, sendButton, "发送"); progress.setVisibility(View.GONE); }); }
        }).start();
    }

    private String requestSse(JSONObject body) throws Exception {
        HttpURLConnection c = open(); c.setRequestProperty("Accept", "text/event-stream");
        try (OutputStream os = c.getOutputStream()) { os.write(body.toString().getBytes("UTF-8")); }
        if (c.getResponseCode() < 200 || c.getResponseCode() >= 300) throw httpError(c);
        StringBuilder answer = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(c.getInputStream(), "UTF-8"))) {
            String line;
            while ((line = reader.readLine()) != null) {
                if (!line.startsWith("data:")) continue;
                String data = line.substring(5).trim(); if (data.equals("[DONE]")) break;
                try {
                    JSONObject event = new JSONObject(data);
                    if ("ai_response".equals(event.optString("type"))) {
                        answer.append(event.optString("content"));
                        String current = answer.toString(); runOnUiThread(() -> { if (answerView != null) answerView.setText(current); });
                    } else if ("mode".equals(event.optString("type"))) {
                        String m = event.optString("mode"); runOnUiThread(() -> { if (status != null) status.setText("自动识别 · " + modeName(m)); });
                    } else if ("card".equals(event.optString("type"))) {
                        JSONObject card=event.optJSONObject("data");if(card!=null)runOnUiThread(()->showCard(card));
                    } else if ("error_message".equals(event.optString("type"))) throw new Exception(event.optString("content"));
                } catch (org.json.JSONException ignored) { }
            }
        } finally { c.disconnect(); }
        return answer.toString();
    }
    private TextView answerView;

    private void startListening() {
        if (busy) return;
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_MIC); return;
        }
        if (!SpeechRecognizer.isRecognitionAvailable(this)) { toast("这台手机暂时没有可用的语音识别服务"); return; }
        if (recognizer != null) recognizer.destroy();
        recognizer = SpeechRecognizer.createSpeechRecognizer(this);
        recognizer.setRecognitionListener(new RecognitionListener() {
            @Override public void onReadyForSpeech(Bundle params) { runOnUiThread(() -> {micButton.setText("正在听…");setCompanionMood(XiaonuanView.Mood.LISTENING,"我在听，您慢慢说…");}); }
            @Override public void onResults(Bundle results) {
                ArrayList<String> list = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                runOnUiThread(() -> { micButton.setText("🎙"); if (list != null && !list.isEmpty()) handleInput(list.get(0));else setCompanionIdle(); });
            }
            @Override public void onError(int error) { runOnUiThread(() -> { micButton.setText("🎙"); if (error != SpeechRecognizer.ERROR_NO_MATCH && error != SpeechRecognizer.ERROR_SPEECH_TIMEOUT) toast("没有听清，请再试一次"); }); }
            @Override public void onBeginningOfSpeech() {} @Override public void onRmsChanged(float rmsdB) {} @Override public void onBufferReceived(byte[] b) {}
            @Override public void onEndOfSpeech() {} @Override public void onPartialResults(Bundle partialResults) {} @Override public void onEvent(int eventType, Bundle params) {}
        });
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "zh-CN"); intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "zh-CN");
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false); recognizer.startListening(intent);
    }

    private void choosePhoto() {
        new AlertDialog.Builder(this).setTitle("给小暖一张照片")
                .setItems(new String[]{"现在拍一张", "从相册选择"}, (d, which) -> { if(which==0)capturePhoto();else pickPhoto(); }).show();
    }
    private void pickPhoto(){Intent pick=new Intent(Intent.ACTION_GET_CONTENT);pick.setType("image/*");startActivityForResult(Intent.createChooser(pick,"选择药盒或医嘱照片"),REQ_PHOTO);}
    private void capturePhoto(){
        try{ContentValues values=new ContentValues();values.put(android.provider.MediaStore.Images.Media.DISPLAY_NAME,"xiaonuan_"+System.currentTimeMillis()+".jpg");values.put(android.provider.MediaStore.Images.Media.MIME_TYPE,"image/jpeg");cameraUri=getContentResolver().insert(android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI,values);if(cameraUri==null)throw new Exception();
            Intent camera=new Intent(android.provider.MediaStore.ACTION_IMAGE_CAPTURE);camera.putExtra(android.provider.MediaStore.EXTRA_OUTPUT,cameraUri);camera.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION);startActivityForResult(camera,REQ_CAMERA);
        }catch(Exception e){cameraUri=null;toast("暂时打不开相机，您可以从相册选择照片");pickPhoto();}
    }
    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if(requestCode==REQ_PHOTO&&resultCode==RESULT_OK&&data!=null&&data.getData()!=null)showPhotoReview(data.getData());
        if(requestCode==REQ_CAMERA){if(resultCode==RESULT_OK&&cameraUri!=null)showPhotoReview(cameraUri);else if(cameraUri!=null)getContentResolver().delete(cameraUri,null,null);cameraUri=null;}
    }
    private void showPhotoReview(Uri uri){
        photoDrafts.clear();photoResult=null;photoConsent=null;otherInfoConsent=null;
        LinearLayout page=column();page.setBackgroundColor(BG);
        LinearLayout head=row();head.setGravity(Gravity.CENTER_VERTICAL);TextView title=text("拍张照片给小暖看",19,INK,true);head.addView(title,new LinearLayout.LayoutParams(0,-2,1));Button close=smallButton("关闭");close.setOnClickListener(v->photoDialog.dismiss());head.addView(close);add(page,head,16,12,16,8);
        ScrollView scroll=new ScrollView(this);photoContent=column();photoContent.setPadding(dp(16),dp(4),dp(16),dp(14));scroll.addView(photoContent);page.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));
        try(InputStream stream=getContentResolver().openInputStream(uri)){BitmapFactory.Options bounds=new BitmapFactory.Options();bounds.inJustDecodeBounds=true;BitmapFactory.decodeStream(stream,null,bounds);int sample=1;while(Math.max(bounds.outWidth/sample,bounds.outHeight/sample)>900)sample*=2;BitmapFactory.Options opts=new BitmapFactory.Options();opts.inSampleSize=sample;try(InputStream input=getContentResolver().openInputStream(uri)){Bitmap bitmap=BitmapFactory.decodeStream(input,null,opts);if(bitmap!=null){ImageView preview=new ImageView(this);preview.setImageBitmap(bitmap);preview.setScaleType(ImageView.ScaleType.FIT_CENTER);preview.setBackground(round(Color.WHITE,16));photoContent.addView(preview,new LinearLayout.LayoutParams(-1,dp(190)));}}}catch(Exception ignored){}
        add(photoContent,text("可拍药盒、处方或医嘱。照片会发送给 MiMo 图片识别服务；建议遮住姓名、身份证号和就诊卡号。小暖不会保存原照片。识别内容只作参考，请逐项对照原件。",14,MUTED,false),0,10,0,8);
        photoConsent=new CheckBox(this);photoConsent.setText("我知道照片会发送给 MiMo 识别，识别结果需要我对照原件核对");photoConsent.setTextColor(INK);photoConsent.setTextSize(14);photoConsent.setButtonTintList(android.content.res.ColorStateList.valueOf(TEAL));photoContent.addView(photoConsent);
        Button recognize=button("开始识别",TEAL);recognize.setOnClickListener(v->{if(photoConsent.isChecked())recognizePhoto(uri);else toast("请先确认照片识别说明");});add(photoContent,recognize,0,6,0,8);
        photoProgress=new ProgressBar(this);photoProgress.setVisibility(View.GONE);photoContent.addView(photoProgress,new LinearLayout.LayoutParams(dp(36),dp(36)));
        LinearLayout footer=row();Button choose=smallButton("换张照片");choose.setOnClickListener(v->{photoDialog.dismiss();choosePhoto();});Button save=button("保存已核对内容",TEAL);save.setOnClickListener(v->saveConfirmedPhoto());footer.addView(choose,new LinearLayout.LayoutParams(0,dp(50),1));LinearLayout.LayoutParams sp=new LinearLayout.LayoutParams(0,dp(50),1);sp.setMargins(dp(8),0,0,0);footer.addView(save,sp);add(page,footer,14,0,14,14);
        photoDialog=new Dialog(this);photoDialog.setContentView(page);Window window=photoDialog.getWindow();if(window!=null){window.setBackgroundDrawableResource(android.R.color.transparent);window.setLayout(-1,(int)(getResources().getDisplayMetrics().heightPixels*.92));window.setGravity(Gravity.BOTTOM);}photoDialog.show();if(window!=null)window.setLayout(-1,(int)(getResources().getDisplayMetrics().heightPixels*.92));
    }
    private byte[] compressedPhoto(Uri uri)throws Exception{
        BitmapFactory.Options bounds=new BitmapFactory.Options();bounds.inJustDecodeBounds=true;try(InputStream in=getContentResolver().openInputStream(uri)){BitmapFactory.decodeStream(in,null,bounds);}int sample=1;while(Math.max(bounds.outWidth/sample,bounds.outHeight/sample)>1500)sample*=2;
        Bitmap bitmap;BitmapFactory.Options options=new BitmapFactory.Options();options.inSampleSize=sample;try(InputStream in=getContentResolver().openInputStream(uri)){bitmap=BitmapFactory.decodeStream(in,null,options);}if(bitmap==null)throw new Exception("照片读取失败，请重新选择");
        ByteArrayOutputStream out=new ByteArrayOutputStream();bitmap.compress(Bitmap.CompressFormat.JPEG,82,out);bitmap.recycle();if(out.size()>6_000_000)throw new Exception("照片仍然太大，请裁剪后重试");return out.toByteArray();
    }
    private void recognizePhoto(Uri uri){
        photoProgress.setVisibility(View.VISIBLE);new Thread(()->{try{byte[]bytes=compressedPhoto(uri);JSONObject result=request("medication_photo_parse",new JSONObject().put("image",Base64.encodeToString(bytes,Base64.NO_WRAP)).put("mime","image/jpeg").put("token",token()),true);runOnUiThread(()->showPhotoResults(result));}catch(Exception e){runOnUiThread(()->{photoProgress.setVisibility(View.GONE);toast(friendly(e));});}}).start();
    }
    private void showPhotoResults(JSONObject result){
        photoProgress.setVisibility(View.GONE);
        photoResult=result;photoDrafts.clear();JSONArray found=result.optJSONArray("medications");if(found!=null)for(int i=0;i<found.length();i++){JSONObject med=found.optJSONObject(i);if(med!=null)photoDrafts.add(new PhotoDraft(med));}
        photoContent.removeAllViews();add(photoContent,text("识别到："+result.optString("document_type","医嘱"),17,INK,true),0,6,0,8);
        add(photoContent,text("每项默认不保存。请对照原件勾选并核对药名、剂量和频次；看不清的请修改或不要保存。",14,MUTED,false),0,0,0,8);
        for(PhotoDraft draft:photoDrafts){LinearLayout card=column();card.setPadding(dp(14),dp(10),dp(14),dp(10));card.setBackground(round(Color.WHITE,16));draft.confirm=new CheckBox(this);draft.confirm.setText("我已对照原件核对这项");draft.confirm.setTextSize(14);draft.confirm.setTextColor(TEAL);card.addView(draft.confirm);
            JSONArray unsure=draft.source.optJSONArray("uncertain_fields");if(unsure!=null&&unsure.length()>0)add(card,text("图片不清楚："+join(unsure,"、")+"。请核实或修改。",13,Color.rgb(174,104,76),false),0,0,0,4);
            String evidence=draft.source.optString("evidence");if(!evidence.isEmpty())add(card,text("图片原文："+evidence,12,MUTED,false),0,0,0,6);
            draft.name=photoField("药品名称",draft.source.optString("name"));draft.dose=photoField("每次剂量",draft.source.optString("dosage"));draft.frequency=photoField("服用频次",draft.source.optString("frequency"));draft.timing=photoField("服用时机",draft.source.optString("timing"));draft.times=photoField("每日提醒钟点，可选，如 08:00",join(draft.source.optJSONArray("reminder_times"),"、"));
            add(card,draft.name,0,3,0,3);add(card,draft.dose,0,3,0,3);add(card,draft.frequency,0,3,0,3);add(card,draft.timing,0,3,0,3);add(card,draft.times,0,3,0,3);add(photoContent,card,0,4,0,6);
        }
        JSONArray warnings=result.optJSONArray("warnings"),unreadable=result.optJSONArray("unreadable");JSONObject follow=result.optJSONObject("follow_up");boolean hasOther=(warnings!=null&&warnings.length()>0)||(unreadable!=null&&unreadable.length()>0)||(follow!=null&&follow.length()>0);
        if(hasOther){LinearLayout other=column();other.setPadding(dp(14),dp(10),dp(14),dp(10));other.setBackground(round(Color.WHITE,16));if(warnings!=null)for(int i=0;i<warnings.length();i++)add(other,text("注意事项："+warnings.optString(i),14,INK,false),0,2,0,3);if(follow!=null){if(!follow.optString("department").isEmpty())add(other,text("复诊科室："+follow.optString("department"),14,INK,false),0,2,0,3);if(!follow.optString("time_hint").isEmpty())add(other,text("复诊时间："+follow.optString("time_hint"),14,INK,false),0,2,0,3);JSONArray bring=follow.optJSONArray("bring");if(bring!=null&&bring.length()>0)add(other,text("复诊需带："+join(bring,"、"),14,INK,false),0,2,0,3);}if(unreadable!=null&&unreadable.length()>0)add(other,text("未读清楚："+join(unreadable,"、"),13,Color.rgb(174,104,76),false),0,2,0,3);otherInfoConsent=new CheckBox(this);otherInfoConsent.setText("我已核对以上注意事项和复诊信息，可以一并保存");otherInfoConsent.setTextSize(14);otherInfoConsent.setTextColor(INK);other.addView(otherInfoConsent);add(photoContent,other,0,4,0,8);}
        add(photoContent,text(photoDrafts.isEmpty()?"没有读出药品项目；可换一张更清晰的照片。":"请只保存已勾选并核对的项目，未勾选药品不会进入记录，也不会设置提醒。",13,MUTED,false),0,8,0,8);
    }
    private EditText photoField(String label,String value){EditText e=field(label);e.setText(value);return e;}
    private String join(JSONArray array,String separator){if(array==null)return "";StringBuilder s=new StringBuilder();for(int i=0;i<array.length();i++){if(i>0)s.append(separator);s.append(array.optString(i));}return s.toString();}
    private void saveConfirmedPhoto(){
        JSONArray selected=new JSONArray();for(PhotoDraft d:photoDrafts){if(d.confirm==null||!d.confirm.isChecked())continue;String name=d.name.getText().toString().trim();if(name.isEmpty())continue;JSONArray times=new JSONArray();for(String t:d.times.getText().toString().split("[,，、\\s]+"))if(t.matches("(?:[01]\\d|2[0-3]):[0-5]\\d"))times.put(t);try{selected.put(new JSONObject().put("name",name).put("dosage",d.dose.getText().toString().trim()).put("frequency",d.frequency.getText().toString().trim()).put("timing",d.timing.getText().toString().trim()).put("reminder_times",times));}catch(Exception ignored){}}
        boolean includeOther=otherInfoConsent!=null&&otherInfoConsent.isChecked();if(selected.length()==0&&!includeOther){toast("请勾选并核对要保存的药品或医嘱信息");return;}
        photoProgress.setVisibility(View.VISIBLE);new Thread(()->{try{
            JSONObject memory=request("memory",new JSONObject().put("token",token()),true);JSONArray all=memory.optJSONArray("medications");if(all==null)all=new JSONArray();java.util.LinkedHashMap<String,JSONObject> merged=new java.util.LinkedHashMap<>();for(int i=0;i<all.length();i++){JSONObject m=all.optJSONObject(i);if(m!=null&&!m.optString("name").isEmpty())merged.put(m.optString("name"),m);}
            for(int i=0;i<selected.length();i++){JSONObject m=selected.getJSONObject(i);JSONObject old=merged.get(m.optString("name"));if(old!=null){for(String k:new String[]{"dosage","frequency","timing"})if(m.optString(k).isEmpty())m.put(k,old.optString(k));if(m.optJSONArray("reminder_times").length()==0)m.put("reminder_times",old.optJSONArray("reminder_times")==null?new JSONArray():old.optJSONArray("reminder_times"));}merged.put(m.optString("name"),m);}
            JSONArray finalMeds=new JSONArray();for(JSONObject m:merged.values())finalMeds.put(m);JSONObject card=new JSONObject().put("type","post").put("source","photo").put("document_type",photoResult.optString("document_type","医嘱")).put("medications",selected);
            if(includeOther){card.put("warnings",photoResult.optJSONArray("warnings") == null?new JSONArray():photoResult.optJSONArray("warnings"));card.put("follow_up",photoResult.optJSONObject("follow_up") == null?new JSONObject():photoResult.optJSONObject("follow_up"));card.put("unreadable",photoResult.optJSONArray("unreadable") == null?new JSONArray():photoResult.optJSONArray("unreadable"));}else{card.put("warnings",new JSONArray());card.put("follow_up",new JSONObject());card.put("unreadable",new JSONArray());}
            JSONObject payload=new JSONObject().put("profile",memory.optJSONObject("profile")==null?new JSONObject():memory.optJSONObject("profile")).put("medications",finalMeds).put("cards",new JSONArray().put(card));
            request("memory_save",new JSONObject().put("token",token()).put("memory",payload),true);runOnUiThread(()->{photoDialog.dismiss();toast("已保存您核对过的内容");openRecords();});
        }catch(Exception e){runOnUiThread(()->{photoProgress.setVisibility(View.GONE);toast(friendly(e));});}}).start();
    }
    private static final class PhotoDraft{final JSONObject source;CheckBox confirm;EditText name,dose,frequency,timing,times;PhotoDraft(JSONObject source){this.source=source;}}

    private void openRecords() {
        setBusy(true, sendButton, "…");
        new Thread(() -> {
            try {
                JSONObject m = request("memory", new JSONObject().put("token",token()), true);
                runOnUiThread(() -> { setBusy(false,sendButton,"发送"); showRecords(m); });
            } catch(Exception e) { runOnUiThread(() -> { setBusy(false,sendButton,"发送"); toast(friendly(e)); }); }
        }).start();
    }
    private void showRecords(JSONObject data) {
        recordsSnapshot=data;
        LinearLayout content = column(); content.setPadding(dp(18),dp(12),dp(18),dp(12));
        JSONObject profile = data.optJSONObject("profile");
        add(content,text("健康档案",16,INK,true),0,4,0,6);
        if(profile==null||profile.length()==0)add(content,text("还没有健康档案。聊天时，小暖会根据您明确说过的信息自动整理。",14,MUTED,false),0,0,0,12);
        else {java.util.Iterator<String> keys=profile.keys();while(keys.hasNext()){String key=keys.next();addRecordRow(content,key+"："+profile.optString(key),"profile",-1,key,profile.opt(key).toString());}}
        add(content,text("用药记录",16,INK,true),0,8,0,6);
        JSONArray meds=data.optJSONArray("medications"); if(meds==null||meds.length()==0) add(content,text("还没有保存用药记录。您可以聊天告诉小暖，或拍照识别后核对保存。",14,MUTED,false),0,0,0,12);
        else {
            pendingReminderJson=meds.toString();
            for(int i=0;i<meds.length();i++){JSONObject med=meds.optJSONObject(i); if(med==null)continue; String line=med.optString("name")+"  "+med.optString("dosage")+"  "+med.optString("frequency")+"  "+med.optString("timing"); JSONArray times=med.optJSONArray("reminder_times");if(times!=null&&times.length()>0)line+="\n提醒时间："+times.toString();addRecordRow(content,line,"medications",i,null,med);}
            Button reminders=smallButton(MedicationReminderScheduler.isEnabled(this)?"关闭按时用药提醒":"开启按时用药提醒");
            reminders.setOnClickListener(v->{if(MedicationReminderScheduler.isEnabled(this)){MedicationReminderScheduler.clear(this);reminders.setText("开启按时用药提醒");toast("用药提醒已关闭");}else enableReminders();});
            add(content,reminders,0,8,0,6);
        }
        add(content,text("保存的卡片",16,INK,true),0,10,0,6);
        JSONArray cards=data.optJSONArray("cards");if(cards==null||cards.length()==0)add(content,text("还没有保存的卡片。",14,MUTED,false),0,0,0,8);
        else for(int i=0;i<cards.length();i++){JSONObject entry=cards.optJSONObject(i);JSONObject card=entry==null?null:entry.optJSONObject("card");String value=card==null?(entry==null?cards.optString(i):entry.toString()):formatCard(card);addRecordRow(content,value,"cards",i,null,entry==null?(Object)value:entry);}
        add(content,text("最近的对话",16,INK,true),0,10,0,6);
        JSONArray recent=data.optJSONArray("recent");if(recent==null||recent.length()==0)add(content,text("还没有最近对话。",14,MUTED,false),0,0,0,8);
        else for(int i=0;i<recent.length();i++){JSONObject entry=recent.optJSONObject(i);String value=entry==null?recent.optString(i):entry.optString("who")+"："+entry.optString("text");addRecordRow(content,value,"recent",i,null,entry==null?value:entry);}
        add(content,text(prefs.getString("user","")+" 的健康记录",12,MUTED,false),0,12,0,4);
        Button logout=smallButton("退出账号");logout.setOnClickListener(v->new AlertDialog.Builder(this).setMessage("退出当前账号吗？云端记录不会删除。").setNegativeButton("取消",null).setPositiveButton("退出",(d,w)->logout()).show());add(content,logout,0,4,0,4);
        Button clear = smallButton("清空全部健康记录"); clear.setTextColor(Color.rgb(179,79,65)); clear.setOnClickListener(v -> new AlertDialog.Builder(this).setMessage("要清空健康档案、用药记录、保存卡片和最近对话吗？此操作无法撤销。")
                .setNegativeButton("取消",null).setPositiveButton("清空",(d,w)->clearMemory()).show()); add(content,clear,0,12,0,0);
        ScrollView scroll=new ScrollView(this); scroll.addView(content);
        new AlertDialog.Builder(this).setTitle("小暖记得的您").setView(scroll).setPositiveButton("关闭",null).show();
    }
    private void addRecordRow(LinearLayout parent,String value,String category,int index,String key,Object expected){
        LinearLayout row=row();row.setGravity(Gravity.CENTER_VERTICAL);
        TextView item=text(value,14,INK,false);item.setPadding(dp(3),dp(4),dp(6),dp(4));row.addView(item,new LinearLayout.LayoutParams(0,-2,1));
        if("profile".equals(category)||"medications".equals(category)){Button edit=smallButton("修改");edit.setOnClickListener(v->editRecord(category,index,key,value));row.addView(edit);}
        Button remove=smallButton("清除");remove.setTextColor(Color.rgb(179,79,65));remove.setOnClickListener(v->new AlertDialog.Builder(this).setMessage("要单独清除此项吗？")
                .setNegativeButton("取消",null).setPositiveButton("清除",(d,w)->deleteRecord(category,index,key,expected)).show());row.addView(remove);
        add(parent,row,0,2,0,5);
    }
    private void editRecord(String category,int index,String key,String current){
        if("profile".equals(category)){
            EditText value=field("填写内容");value.setText(recordsSnapshot.optJSONObject("profile").optString(key));
            new AlertDialog.Builder(this).setTitle("修改"+key).setView(value).setNegativeButton("取消",null).setPositiveButton("保存",(d,w)->{
                try{JSONObject profile=recordsSnapshot.optJSONObject("profile");profile.put(key,value.getText().toString().trim());saveMemory(profile,recordsSnapshot.optJSONArray("medications"),recordsSnapshot.optJSONArray("cards"));}catch(Exception e){toast("保存失败");}
            }).show();return;
        }
        JSONArray meds=recordsSnapshot.optJSONArray("medications");JSONObject med=meds==null?null:meds.optJSONObject(index);if(med==null)return;
        LinearLayout form=column();form.setPadding(dp(8),dp(6),dp(8),dp(6));EditText name=field("药品名称"),dose=field("剂量"),freq=field("服用频次"),timing=field("服药时间或时机"),times=field("提醒钟点，例如 08:00、20:00");
        name.setText(med.optString("name"));dose.setText(med.optString("dosage"));freq.setText(med.optString("frequency"));timing.setText(med.optString("timing"));JSONArray reminderTimes=med.optJSONArray("reminder_times");if(reminderTimes!=null){StringBuilder ts=new StringBuilder();for(int i=0;i<reminderTimes.length();i++){if(i>0)ts.append("、");ts.append(reminderTimes.optString(i));}times.setText(ts.toString());}
        add(form,name,0,4,0,4);add(form,dose,0,4,0,4);add(form,freq,0,4,0,4);add(form,timing,0,4,0,4);add(form,times,0,4,0,4);
        new AlertDialog.Builder(this).setTitle("修改用药记录").setView(form).setNegativeButton("取消",null).setPositiveButton("保存",(d,w)->{
            try{med.put("name",name.getText().toString().trim()).put("dosage",dose.getText().toString().trim()).put("frequency",freq.getText().toString().trim()).put("timing",timing.getText().toString().trim());JSONArray normalized=new JSONArray();for(String t:times.getText().toString().split("[,，、 ]+")){if(t.matches("(?:[01]\\d|2[0-3]):[0-5]\\d"))normalized.put(t);}med.put("reminder_times",normalized);saveMemory(recordsSnapshot.optJSONObject("profile"),meds,recordsSnapshot.optJSONArray("cards"));}
            catch(Exception e){toast("保存失败，请检查填写内容");}
        }).show();
    }
    private void saveMemory(JSONObject profile,JSONArray meds,JSONArray cards){
        JSONObject payload=new JSONObject();try{payload.put("profile",profile==null?new JSONObject():profile);payload.put("medications",meds==null?new JSONArray():meds);payload.put("cards",new JSONArray());}catch(Exception ignored){}
        toast("正在保存…");new Thread(()->{try{request("memory_save",new JSONObject().put("token",token()).put("memory",payload),true);runOnUiThread(()->{toast("已保存");openRecords();});}catch(Exception e){runOnUiThread(()->toast(friendly(e)));}}).start();
    }
    private void deleteRecord(String category,int index,String key,Object expected){
        Dialog loading=loadingDialog("正在清除…");new Thread(()->{try{
            JSONObject body=new JSONObject().put("token",token()).put("category",category).put("index",index).put("expected",expected);if(key!=null)body.put("key",key);
            request("memory_item_delete",body,true);runOnUiThread(()->{loading.dismiss();toast("已清除");openRecords();});
        }catch(Exception e){runOnUiThread(()->{loading.dismiss();toast(friendly(e));});}}).start();
    }
    private void clearMemory(){new Thread(()->{try{request("memory_clear",new JSONObject().put("token",token()),true);runOnUiThread(()->toast("健康记录已清空"));}catch(Exception e){runOnUiThread(()->toast(friendly(e)));}}).start();}
    private void logout(){String oldToken=token();new Thread(()->{try{request("logout",new JSONObject().put("token",oldToken),false);}catch(Exception ignored){}runOnUiThread(()->{prefs.edit().remove("token").remove("user").remove("cid").apply();showAuth();});}).start();}
    private void enableReminders(){
        if(pendingReminderJson.equals("[]")){toast("还没有用药记录");return;}
        if(android.os.Build.VERSION.SDK_INT>=33&&checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED){requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},52);return;}
        if(android.os.Build.VERSION.SDK_INT>=31){android.app.AlarmManager alarm=(android.app.AlarmManager)getSystemService(ALARM_SERVICE);if(alarm!=null&&!alarm.canScheduleExactAlarms()){try{startActivity(new Intent(android.provider.Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,Uri.parse("package:"+getPackageName())));}catch(Exception ignored){}}}
        MedicationReminderScheduler.sync(this,pendingReminderJson);toast("用药提醒已开启；请确认每种药都填写了具体钟点");
    }
    private void refreshRecordsQuietly() { /* 记录自动保存由服务端完成；面板在打开时重新读取。 */ }

    private String formatCard(JSONObject card){
        StringBuilder out=new StringBuilder();String type=card.optString("type");
        if("pre".equals(type)){out.append("就诊前信息整理（请核对）");JSONObject summary=card.optJSONObject("visit_summary");if(summary!=null){String[][]fields={{"symptoms","主要不适"},{"duration","持续时间"},{"history","既往情况"},{"current_meds","当前用药"},{"questions","想问医生"},{"missing","就诊时可补充"}};for(String[]f:fields){String value=summary.optString(f[0],"");if(!value.isEmpty())out.append("\n").append(f[1]).append("：").append(value);}}out.append("\n仅整理对话信息，不是诊断结论。");return out.toString();}
        if("photo".equals(card.optString("source")))out.append(card.optString("document_type","医嘱")).append("照片整理（您已核对）");
        JSONArray meds=card.optJSONArray("medications");if(meds!=null)for(int i=0;i<meds.length();i++){JSONObject m=meds.optJSONObject(i);if(m==null)continue;out.append("\n用药：").append(m.optString("name"));for(String k:new String[]{"dosage","frequency","timing"})if(!m.optString(k).isEmpty())out.append("，").append(m.optString(k));}
        JSONArray warnings=card.optJSONArray("warnings");if(warnings!=null)for(int i=0;i<warnings.length();i++)out.append("\n注意事项：").append(warnings.optString(i));JSONObject follow=card.optJSONObject("follow_up");if(follow!=null&&follow.length()>0){out.append("\n复诊：").append(follow.optString("department")).append(" ").append(follow.optString("time_hint"));JSONArray bring=follow.optJSONArray("bring");if(bring!=null&&bring.length()>0)out.append("，带上").append(join(bring,"、"));}if(out.length()==0)out.append(card.toString());out.append("\n请以医生原始医嘱为准。");return out.toString();
    }
    private Dialog loadingDialog(String message){LinearLayout box=row();box.setGravity(Gravity.CENTER_VERTICAL);box.setPadding(dp(20),dp(18),dp(20),dp(18));ProgressBar spinner=new ProgressBar(this);box.addView(spinner,new LinearLayout.LayoutParams(dp(32),dp(32)));TextView label=text(message,15,INK,false);LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-2,-2);p.setMargins(dp(14),0,0,0);box.addView(label,p);Dialog dialog=new Dialog(this);dialog.setContentView(box);if(dialog.getWindow()!=null)dialog.getWindow().setBackgroundDrawable(round(Color.WHITE,20));dialog.setCancelable(false);dialog.show();if(dialog.getWindow()!=null)dialog.getWindow().setLayout(-2,-2);return dialog;}
    private void showActivationDialog(){
        LinearLayout box=column();box.setGravity(Gravity.CENTER);box.setPadding(dp(24),dp(24),dp(24),dp(22));TextView icon=text("🎙",29,TEAL,true);icon.setGravity(Gravity.CENTER);add(box,icon,0,0,0,8);add(box,text("点击激活并开启麦克风",21,INK,true),0,0,0,8);TextView detail=text("点击后小暖就能听您说话。您也可以直接打字聊天；可以说“帮我看药盒”“放大字幕”或“打开我的记录”。",14,MUTED,false);detail.setGravity(Gravity.CENTER);add(box,detail,0,0,0,14);
        Dialog dialog=new Dialog(this);Button activate=button("点击激活小暖",TEAL);activate.setOnClickListener(v->{prefs.edit().putBoolean("native_activated_once",true).apply();dialog.dismiss();startListening();});add(box,activate,0,0,0,0);dialog.setContentView(box);dialog.setCancelable(false);dialog.show();if(dialog.getWindow()!=null){dialog.getWindow().setBackgroundDrawable(round(Color.WHITE,26));dialog.getWindow().setLayout((int)(getResources().getDisplayMetrics().widthPixels*.86),-2);}
    }

    private JSONObject request(String action, JSONObject payload, boolean auth) throws Exception {
        HttpURLConnection c=open(); payload.put("action",action); if(auth && !payload.has("token"))payload.put("token",token());
        try(OutputStream os=c.getOutputStream()){os.write(payload.toString().getBytes("UTF-8"));}
        int code=c.getResponseCode(); if(code<200||code>=300)throw httpError(c);
        try(InputStream in=c.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] b=new byte[4096];int n;while((n=in.read(b))!=-1)out.write(b,0,n);return new JSONObject(out.toString("UTF-8"));}
        finally{c.disconnect();}
    }
    private HttpURLConnection open() throws Exception {
        HttpURLConnection c=(HttpURLConnection)new URL(API).openConnection();c.setRequestMethod("POST");c.setConnectTimeout(20000);c.setReadTimeout(90000);c.setDoOutput(true);c.setRequestProperty("Content-Type","application/json; charset=utf-8");c.setRequestProperty("makers-conversation-id",cid());return c;
    }
    private Exception httpError(HttpURLConnection c) {
        try(InputStream e=c.getErrorStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){if(e!=null){byte[]b=new byte[2048];int n;while((n=e.read(b))!=-1)out.write(b,0,n);JSONObject j=new JSONObject(out.toString("UTF-8"));return new Exception(j.optString("error","服务暂时不可用"));}}catch(Exception ignored){}int code=-1;try{code=c.getResponseCode();}catch(Exception ignored){}return new Exception("服务暂时不可用（"+code+"）");
    }

    private TextView addBubble(String who,String value,boolean mine){
        LinearLayout wrap=column(); wrap.setGravity(mine?Gravity.END:Gravity.START);
        TextView label=text(who,11,MUTED,false); label.setPadding(dp(4),0,dp(4),dp(3));
        TextView body=text(value,captionsLarge?22:16,INK,false);body.setPadding(dp(14),dp(11),dp(14),dp(11));body.setBackground(round(mine?Color.rgb(224,241,236):Color.WHITE,18));body.setMaxWidth((int)(getResources().getDisplayMetrics().widthPixels*.82));
        add(wrap,label,0,2,0,0);add(wrap,body,0,0,0,10);messages.addView(wrap);chatScroll.post(()->chatScroll.fullScroll(View.FOCUS_DOWN));
        if(!mine)answerView=body; return body;
    }
    private void showCard(JSONObject card){
        latestCard=card;
        String summary=formatCard(card);
        TextView body=addBubble("小暖整理的卡片",summary,false);
        body.setTextSize(captionsLarge?22:15);
        LinearLayout actions=row();
        Button copy=smallButton("复制内容");
        copy.setOnClickListener(v->{android.content.ClipboardManager cm=(android.content.ClipboardManager)getSystemService(CLIPBOARD_SERVICE);if(cm!=null){cm.setPrimaryClip(android.content.ClipData.newPlainText("小暖卡片",summary));toast("已复制，可粘贴给家人或医生");}});
        Button share=smallButton("分享给家人");
        share.setOnClickListener(v->{Intent send=new Intent(Intent.ACTION_SEND);send.setType("text/plain");send.putExtra(Intent.EXTRA_TEXT,summary);startActivity(Intent.createChooser(send,"分享小暖整理的内容"));});
        actions.addView(copy);LinearLayout.LayoutParams sp=new LinearLayout.LayoutParams(-2,-2);sp.setMargins(dp(8),0,0,0);actions.addView(share,sp);add(messages,actions,4,0,0,10);
        chatScroll.post(()->chatScroll.fullScroll(View.FOCUS_DOWN));
    }
    private void speak(String text){if(!speakerEnabled||!speakingReady||tts==null)return;tts.stop();tts.speak(text,TextToSpeech.QUEUE_FLUSH,null,"xiaonuan-reply");}
    private void setCompanionMood(XiaonuanView.Mood mood,String hint){if(mascot!=null)mascot.setMood(mood);if(companionHint!=null&&hint!=null)companionHint.setText(hint);}
    private void setCompanionIdle(){if(mascot!=null)mascot.setMood(XiaonuanView.Mood.IDLE);if(companionHint!=null)companionHint.setText("我在这里，您可以继续说。");}
    private void setBusy(boolean value,Button button,String label){busy=value;if(button!=null){button.setEnabled(!value);button.setText(label);}}
    private LinearLayout page(){LinearLayout l=new LinearLayout(this);l.setOrientation(LinearLayout.VERTICAL);l.setPadding(0,dp(8),0,0);l.setBackgroundColor(BG);return l;}
    private LinearLayout column(){LinearLayout l=new LinearLayout(this);l.setOrientation(LinearLayout.VERTICAL);return l;}
    private LinearLayout row(){LinearLayout l=new LinearLayout(this);l.setOrientation(LinearLayout.HORIZONTAL);return l;}
    private TextView text(String s,int size,int color,boolean bold){TextView t=new TextView(this);t.setText(s);t.setTextSize(size);t.setTextColor(color);if(bold)t.setTypeface(Typeface.DEFAULT,Typeface.BOLD);return t;}
    private EditText field(String hint){EditText e=new EditText(this);e.setSingleLine(true);e.setTextSize(16);e.setHint(hint);e.setPadding(dp(14),dp(10),dp(14),dp(10));e.setBackground(round(BG,14));return e;}
    private Button button(String label,int color){Button b=new Button(this);b.setText(label);b.setTextSize(15);b.setAllCaps(false);b.setTextColor(Color.WHITE);b.setBackground(round(color,16));return b;}
    private Button smallButton(String label){Button b=new Button(this);b.setText(label);b.setTextSize(12);b.setAllCaps(false);b.setMinHeight(dp(40));b.setMinimumHeight(dp(40));b.setPadding(dp(8),0,dp(8),0);b.setTextColor(TEAL);b.setBackground(round(Color.WHITE,14));return b;}
    private GradientDrawable round(int color,int radius){GradientDrawable d=new GradientDrawable();d.setColor(color);d.setCornerRadius(dp(radius));return d;}
    private void add(LinearLayout parent,View child,int left,int top,int right,int bottom){LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,-2);p.setMargins(dp(left),dp(top),dp(right),dp(bottom));parent.addView(child,p);}
    private int dp(float x){return (int)(x*getResources().getDisplayMetrics().density+.5f);}
    private String token(){return prefs.getString("token","");}
    private String cid(){String c=prefs.getString("cid","");if(c.isEmpty()){c=newCid();prefs.edit().putString("cid",c).apply();}return c;}
    private String newCid(){return "c-"+UUID.randomUUID().toString().replace("-","");}
    private String friendly(Exception e){String m=e.getMessage();if(m==null||m.isEmpty())return "网络暂时不稳定，请稍后再试。";if(m.contains("401")||m.contains("请先登录")){prefs.edit().clear().apply();runOnUiThread(this::showAuth);return "登录状态已过期，请重新登录。";}return m;}
    private String modeName(String mode){switch(mode){case "pre":return "就诊前准备";case "post":return "就诊后整理";default:return "日常聊天";}}
    private void toast(String s){Toast.makeText(this,s,Toast.LENGTH_LONG).show();}

    @Override public void onRequestPermissionsResult(int requestCode,String[] permissions,int[] results){super.onRequestPermissionsResult(requestCode,permissions,results);if(requestCode==REQ_MIC&&results.length>0&&results[0]==PackageManager.PERMISSION_GRANTED)startListening();else if(requestCode==REQ_MIC)toast("允许麦克风后才能语音聊天");else if(requestCode==52&&results.length>0&&results[0]==PackageManager.PERMISSION_GRANTED)enableReminders();}
    @Override public void onBackPressed(){new AlertDialog.Builder(this).setMessage("要退出小暖吗？").setNegativeButton("继续使用",null).setPositiveButton("退出",(d,w)->finish()).show();}
    @Override protected void onDestroy(){if(recognizer!=null){recognizer.destroy();recognizer=null;}if(tts!=null){tts.stop();tts.shutdown();}super.onDestroy();}
}
