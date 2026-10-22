package com.xiaonuan.companion;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.util.Base64;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.view.inputmethod.InputMethodManager;
import android.content.Context;
import android.widget.Button;
import android.widget.EditText;
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
    private String pendingText = "";
    private String pendingReminderJson = "[]";
    private JSONArray medications = new JSONArray();
    private JSONObject recordsSnapshot = new JSONObject();

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setStatusBarColor(BG);
        getWindow().setNavigationBarColor(Color.WHITE);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        prefs = getSharedPreferences("xiaonuan_native", MODE_PRIVATE);
        tts = new TextToSpeech(this, result -> {
            if (result == TextToSpeech.SUCCESS) {
                tts.setLanguage(Locale.SIMPLIFIED_CHINESE);
                tts.setSpeechRate(prefs.getBoolean("slow", true) ? 0.82f : 1.0f);
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
        tools.addView(photo); tools.addView(slow); tools.addView(repeat); add(root, tools, 12, 4, 12, 6);
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
    }

    private void sendText() {
        String text = input.getText().toString().trim(); if (text.isEmpty() || busy) return;
        input.setText(""); ((InputMethodManager)getSystemService(INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(input.getWindowToken(), 0);
        addBubble("您", text, true); ask(text);
    }

    private void ask(String message) {
        setBusy(true, sendButton, "…"); progress.setVisibility(View.VISIBLE);
        TextView answer = addBubble("小暖", "正在听您说…", false);
        new Thread(() -> {
            try {
                JSONObject body = new JSONObject().put("message", message).put("mode", prefs.getString("mode", "auto")).put("token", token());
                String answerText = requestSse(body);
                String finalAnswer = answerText.trim().isEmpty() ? "这次没有听清楚，请您再说一遍。" : answerText.trim();
                runOnUiThread(() -> { answer.setText(finalAnswer); pendingText = finalAnswer; speak(finalAnswer); refreshRecordsQuietly(); });
            } catch (Exception e) { runOnUiThread(() -> answer.setText(friendly(e))); }
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
            @Override public void onReadyForSpeech(Bundle params) { runOnUiThread(() -> micButton.setText("正在听…")); }
            @Override public void onResults(Bundle results) {
                ArrayList<String> list = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                runOnUiThread(() -> { micButton.setText("🎙"); if (list != null && !list.isEmpty()) { String said = list.get(0); addBubble("您", said, true); ask(said); } });
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
        Intent pick = new Intent(Intent.ACTION_GET_CONTENT); pick.setType("image/*");
        startActivityForResult(Intent.createChooser(pick, "拍摄或选择药盒、医嘱照片"), REQ_PHOTO);
    }
    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_PHOTO && resultCode == RESULT_OK && data != null && data.getData() != null) parsePhoto(data.getData());
    }
    private void parsePhoto(Uri uri) {
        addBubble("您", "已选择一张照片，请帮我看看。", true); setBusy(true, sendButton, "…"); progress.setVisibility(View.VISIBLE);
        TextView response = addBubble("小暖", "正在辨认照片…", false);
        new Thread(() -> {
            try {
                byte[] bytes; try (InputStream is = getContentResolver().openInputStream(uri); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                    if (is == null) throw new Exception("无法读取这张照片"); byte[] buffer = new byte[8192]; int n; while ((n = is.read(buffer)) > 0 && out.size() < 7_000_000) out.write(buffer, 0, n); bytes = out.toByteArray();
                }
                String type = getContentResolver().getType(uri); if (type == null || !type.matches("image/(jpeg|png|webp)")) type = "image/jpeg";
                JSONObject payload = new JSONObject().put("image", Base64.encodeToString(bytes, Base64.NO_WRAP)).put("mime", type).put("token", token());
                JSONObject parsed = request("medication_photo_parse", payload, true);
                JSONArray found = parsed.optJSONArray("medications"); if (found == null) found = new JSONArray(); medications = found;
                StringBuilder summary = new StringBuilder("我先把照片里看清楚的内容整理出来，请您和原件核对：\n");
                for (int i=0;i<found.length();i++) { JSONObject med=found.optJSONObject(i); if (med==null) continue; summary.append("\n• ").append(med.optString("name","药品")); for(String key:new String[]{"dosage","frequency","timing"}) if(!med.optString(key).isEmpty()) summary.append("，").append(med.optString(key)); if(med.optJSONArray("uncertain_fields")!=null && med.optJSONArray("uncertain_fields").length()>0) summary.append("（有内容看不清）"); }
                JSONArray warnings=parsed.optJSONArray("warnings"); if(warnings!=null) for(int i=0;i<warnings.length();i++) summary.append("\n注意：").append(warnings.optString(i));
                if(found.length()==0) summary.append("\n这张照片里没有清楚读出药品名称。请换个光线更好的角度重拍。"); else summary.append("\n\n请您核对药名和用法。确认无误后，告诉我“保存这份用药记录”。");
                String display=summary.toString(); boolean hasFound = found.length() > 0; runOnUiThread(() -> {
                    response.setText(display); pendingText=display;
                    if (hasFound) {
                        Button confirm = smallButton("核对后保存用药记录");
                        confirm.setOnClickListener(v -> new AlertDialog.Builder(this)
                                .setMessage("请确认药名、剂量和用法与医生原始医嘱一致，再保存到用药记录。")
                                .setNegativeButton("再核对一下", null)
                                .setPositiveButton("确认保存", (dialog, which) -> saveDetectedMeds()).show());
                        add(messages, confirm, 4, 0, 0, 12);
                        chatScroll.post(() -> chatScroll.fullScroll(View.FOCUS_DOWN));
                    }
                });
            } catch(Exception e) { runOnUiThread(() -> response.setText(friendly(e))); }
            finally { runOnUiThread(() -> { setBusy(false,sendButton,"发送"); progress.setVisibility(View.GONE); }); }
        }).start();
    }

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
        else for(int i=0;i<cards.length();i++){JSONObject entry=cards.optJSONObject(i);String value=entry==null?cards.optString(i):entry.optJSONObject("card")!=null?entry.optJSONObject("card").toString():entry.toString();addRecordRow(content,"卡片："+value,"cards",i,null,entry==null?value:entry);}
        add(content,text("最近的对话",16,INK,true),0,10,0,6);
        JSONArray recent=data.optJSONArray("recent");if(recent==null||recent.length()==0)add(content,text("还没有最近对话。",14,MUTED,false),0,0,0,8);
        else for(int i=0;i<recent.length();i++){JSONObject entry=recent.optJSONObject(i);String value=entry==null?recent.optString(i):entry.optString("who")+"："+entry.optString("text");addRecordRow(content,value,"recent",i,null,entry==null?value:entry);}
        Button clear = smallButton("清空全部健康记录"); clear.setTextColor(Color.rgb(179,79,65)); clear.setOnClickListener(v -> new AlertDialog.Builder(this).setMessage("要清空健康档案、用药记录和保存卡片吗？此操作无法撤销。")
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
        JSONObject payload=new JSONObject();try{payload.put("profile",profile==null?new JSONObject():profile);payload.put("medications",meds==null?new JSONArray():meds);payload.put("cards",cards==null?new JSONArray():cards);}catch(Exception ignored){}
        toast("正在保存…");new Thread(()->{try{request("memory_save",new JSONObject().put("token",token()).put("memory",payload),true);runOnUiThread(()->{toast("已保存");openRecords();});}catch(Exception e){runOnUiThread(()->toast(friendly(e)));}}).start();
    }
    private void deleteRecord(String category,int index,String key,Object expected){
        toast("正在清除…");new Thread(()->{try{
            JSONObject body=new JSONObject().put("token",token()).put("category",category).put("index",index).put("expected",expected);if(key!=null)body.put("key",key);
            request("memory_item_delete",body,true);runOnUiThread(()->{toast("已清除");openRecords();});
        }catch(Exception e){runOnUiThread(()->toast(friendly(e)));}}).start();
    }
    private void clearMemory(){new Thread(()->{try{request("memory_clear",new JSONObject().put("token",token()),true);runOnUiThread(()->toast("健康记录已清空"));}catch(Exception e){runOnUiThread(()->toast(friendly(e)));}}).start();}
    private void enableReminders(){
        if(pendingReminderJson.equals("[]")){toast("还没有用药记录");return;}
        if(android.os.Build.VERSION.SDK_INT>=33&&checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED){requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},52);return;}
        if(android.os.Build.VERSION.SDK_INT>=31){android.app.AlarmManager alarm=(android.app.AlarmManager)getSystemService(ALARM_SERVICE);if(alarm!=null&&!alarm.canScheduleExactAlarms()){try{startActivity(new Intent(android.provider.Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,Uri.parse("package:"+getPackageName())));}catch(Exception ignored){}}}
        MedicationReminderScheduler.sync(this,pendingReminderJson);toast("用药提醒已开启；请确认每种药都填写了具体钟点");
    }
    private void refreshRecordsQuietly() { /* 记录自动保存由服务端完成；面板在打开时重新读取。 */ }

    private void saveDetectedMeds() {
        if(medications.length()==0){toast("照片里还没有识别出可保存的药品");return;}
        new Thread(()->{try{
            JSONObject memory=request("memory",new JSONObject().put("token",token()),true); JSONArray all=memory.optJSONArray("medications"); if(all==null)all=new JSONArray();
            for(int i=0;i<medications.length();i++){JSONObject item=medications.optJSONObject(i);if(item==null)continue;JSONObject med=new JSONObject().put("name",item.optString("name")).put("dosage",item.optString("dosage")).put("frequency",item.optString("frequency")).put("timing",item.optString("timing")).put("reminder_times",new JSONArray()); if(!med.optString("name").isEmpty())all.put(med);}
            JSONObject updated=new JSONObject().put("profile",memory.optJSONObject("profile") == null ? new JSONObject() : memory.optJSONObject("profile")).put("medications",all).put("cards",memory.optJSONArray("cards") == null ? new JSONArray() : memory.optJSONArray("cards"));
            request("memory_save",new JSONObject().put("token",token()).put("memory",updated),true);runOnUiThread(()->toast("已保存，请按医生交代补充具体时间"));
        }catch(Exception e){runOnUiThread(()->toast(friendly(e)));}}).start();
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
        TextView body=text(value,16,INK,false);body.setPadding(dp(14),dp(11),dp(14),dp(11));body.setBackground(round(mine?Color.rgb(224,241,236):Color.WHITE,18));body.setMaxWidth((int)(getResources().getDisplayMetrics().widthPixels*.82));
        add(wrap,label,0,2,0,0);add(wrap,body,0,0,0,10);messages.addView(wrap);chatScroll.post(()->chatScroll.fullScroll(View.FOCUS_DOWN));
        if(!mine)answerView=body; return body;
    }
    private void speak(String text){if(!speakingReady||tts==null)return;tts.stop();tts.speak(text,TextToSpeech.QUEUE_FLUSH,null,"xiaonuan-reply");}
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
