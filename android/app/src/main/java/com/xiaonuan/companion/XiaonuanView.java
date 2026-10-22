package com.xiaonuan.companion;

import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RadialGradient;
import android.graphics.Shader;
import android.util.AttributeSet;
import android.view.View;
import android.view.animation.AccelerateDecelerateInterpolator;

/** 小暖的 Android 原生矢量角色：闲置、聆听、思考、说话均在 Canvas 上绘制。 */
public final class XiaonuanView extends View {
    public enum Mood { IDLE, LISTENING, THINKING, SPEAKING }
    private final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
    private Mood mood = Mood.IDLE;
    private float phase;
    private final ValueAnimator animator;

    public XiaonuanView(Context context) { this(context, null); }
    public XiaonuanView(Context context, AttributeSet attrs) {
        super(context, attrs);
        setLayerType(View.LAYER_TYPE_SOFTWARE, null);
        animator = ValueAnimator.ofFloat(0f, (float)(Math.PI * 2));
        animator.setDuration(2600); animator.setRepeatCount(ValueAnimator.INFINITE);
        animator.setInterpolator(new AccelerateDecelerateInterpolator());
        animator.addUpdateListener(a -> { phase = (float)a.getAnimatedValue(); invalidate(); });
        animator.start();
    }

    public void setMood(Mood next) { if (next != null && mood != next) { mood = next; invalidate(); } }
    public Mood getMood() { return mood; }

    @Override protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        float s = Math.min(getWidth(), getHeight()) / 320f;
        canvas.save(); canvas.translate((getWidth()-320*s)/2f, (getHeight()-320*s)/2f); canvas.scale(s,s);
        float bob = mood == Mood.LISTENING ? (float)Math.sin(phase*1.4f)*2f : mood == Mood.IDLE ? (float)Math.sin(phase)*1.2f : 0;
        canvas.translate(0,bob);
        drawBody(canvas);
        if (mood == Mood.THINKING) drawThinking(canvas);
        if (mood == Mood.LISTENING) drawListening(canvas);
        if (mood == Mood.SPEAKING) drawSpeaking(canvas);
        canvas.restore();
    }

    private void drawBody(Canvas c) {
        p.setStyle(Paint.Style.FILL); p.setColor(0x24548e8b); c.drawOval(75,296,245,315,p);
        p.setShader(new LinearGradient(65,30,250,240, new int[]{0xff69505d,0xff463746,0xff302d3b},null,Shader.TileMode.CLAMP));
        c.drawRoundRect(74,23,246,273,78,78,p); p.setShader(null);
        // 外套与衣领
        p.setShader(new LinearGradient(45,215,275,320,0xff82c7bd,0xff398d8a,Shader.TileMode.CLAMP));
        Path coat=new Path();coat.moveTo(42,315);coat.cubicTo(48,260,76,235,121,220);coat.lineTo(160,241);coat.lineTo(199,220);coat.cubicTo(246,234,272,263,278,315);coat.close();c.drawPath(coat,p);p.setShader(null);
        p.setColor(0xfffffaf5);Path collar=new Path();collar.moveTo(115,222);collar.lineTo(160,250);collar.lineTo(136,283);collar.lineTo(100,238);collar.close();c.drawPath(collar,p);
        collar.reset();collar.moveTo(205,222);collar.lineTo(160,250);collar.lineTo(184,283);collar.lineTo(220,238);collar.close();c.drawPath(collar,p);
        p.setColor(0xffe9f5ef);Path tie=new Path();tie.moveTo(160,250);tie.lineTo(170,266);tie.lineTo(160,300);tie.lineTo(150,266);tie.close();c.drawPath(tie,p);
        // 脖子和脸
        p.setShader(new RadialGradient(131,104,120,new int[]{0xfffff0df,0xfff0b9a9},null,Shader.TileMode.CLAMP));c.drawRect(137,180,183,235,p);c.drawOval(91,50,229,207,p);p.setShader(null);
        // 发尾和刘海
        p.setColor(0xff3e3543);Path hair=new Path();hair.moveTo(91,116);hair.cubicTo(75,35,113,10,160,16);hair.cubicTo(218,10,248,49,230,120);hair.lineTo(240,208);hair.cubicTo(226,260,211,272,200,276);hair.cubicTo(223,226,218,164,218,120);hair.cubicTo(188,111,179,91,174,77);hair.cubicTo(156,104,125,113,91,116);hair.close();c.drawPath(hair,p);
        // 脸部细节
        p.setColor(0xfff2c4b2);c.drawOval(75,127,101,165,p);c.drawOval(219,127,245,165,p);
        p.setColor(0x40e88987);c.drawOval(99,165,126,181,p);c.drawOval(194,165,221,181,p);
        p.setColor(0xffffffff);c.drawOval(111,130,137,164,p);c.drawOval(183,130,209,164,p);
        p.setShader(new RadialGradient(121,139,20,new int[]{0xff89c6bd,0xff448d89,0xff285d69},null,Shader.TileMode.CLAMP));c.drawOval(116,136,133,163,p);p.setShader(null);
        p.setShader(new RadialGradient(193,139,20,new int[]{0xff89c6bd,0xff448d89,0xff285d69},null,Shader.TileMode.CLAMP));c.drawOval(187,136,204,163,p);p.setShader(null);
        p.setColor(0xff293c4a);c.drawOval(121,139,129,158,p);c.drawOval(191,139,199,158,p);
        p.setColor(Color.WHITE);c.drawCircle(122,141,4,p);c.drawCircle(192,141,4,p);
        p.setStyle(Paint.Style.STROKE);p.setStrokeWidth(3);p.setStrokeCap(Paint.Cap.ROUND);p.setColor(0xff493842);
        c.drawArc(105,119,140,145,200,135,false,p);c.drawArc(180,119,215,145,205,135,false,p);
        p.setStrokeWidth(2.5f);p.setColor(0xff92616a);c.drawArc(108,115,145,129,190,150,false,p);c.drawArc(175,115,212,129,200,150,false,p);
        // 耳机头梁与耳罩
        p.setStrokeWidth(9);p.setColor(0xffedaa9b);c.drawArc(80,18,240,151,185,170,false,p);
        p.setStyle(Paint.Style.FILL);c.drawRoundRect(73,116,98,164,11,11,p);c.drawRoundRect(222,116,247,164,11,11,p);
        p.setColor(0xfffff4ec);c.drawRoundRect(80,123,88,155,4,4,p);c.drawRoundRect(231,123,239,155,4,4,p);
        // 蝴蝶结
        p.setColor(0xfff2a99a);Path bow=new Path();bow.moveTo(205,73);bow.lineTo(220,58);bow.lineTo(222,79);bow.lineTo(207,82);bow.close();c.drawPath(bow,p);
        bow.reset();bow.moveTo(204,73);bow.lineTo(188,60);bow.lineTo(188,80);bow.lineTo(204,82);bow.close();c.drawPath(bow,p);p.setColor(0xffffdfc3);c.drawCircle(205,74,4,p);
        // 微笑；说话时切换为小幅张嘴动画
        p.setStyle(Paint.Style.STROKE);p.setStrokeWidth(3);p.setColor(0xffa85c67);p.setStrokeCap(Paint.Cap.ROUND);
        if(mood==Mood.SPEAKING && Math.sin(phase*5)>0){p.setStyle(Paint.Style.FILL);c.drawOval(153,177,167,193,p);}else c.drawArc(143,174,177,196,20,140,false,p);
        p.setStyle(Paint.Style.FILL);
    }

    private void drawThinking(Canvas c) {
        p.setStyle(Paint.Style.FILL);p.setColor(0xfffffdf9);c.drawRoundRect(22,69,96,109,18,18,p);p.setColor(0xff83b7b0);
        float wave=(float)Math.sin(phase*2)*3; c.drawCircle(43,89+wave,3.5f,p);c.drawCircle(59,89,3.5f,p);c.drawCircle(75,89-wave,3.5f,p);
    }
    private void drawListening(Canvas c) {
        p.setStyle(Paint.Style.STROKE);p.setStrokeWidth(3);p.setColor(0x8874b9ae);float r=7+(float)(Math.sin(phase*2)+1)*4;c.drawArc(61-r,130-r,91+r,160+r,-80,160,false,p);c.drawArc(229-r,130-r,259+r,160+r,100,160,false,p);p.setStyle(Paint.Style.FILL);
    }
    private void drawSpeaking(Canvas c) {
        p.setStyle(Paint.Style.FILL);p.setColor(0xffe6b86f);float a=4+(float)(Math.sin(phase*3)+1)*2;Path star=new Path();star.moveTo(263,58-a);star.lineTo(267,68);star.lineTo(277+a,72);star.lineTo(267,76);star.lineTo(263,86+a);star.lineTo(259,76);star.lineTo(249-a,72);star.lineTo(259,68);star.close();c.drawPath(star,p);
    }

    @Override protected void onDetachedFromWindow(){animator.cancel();super.onDetachedFromWindow();}
}
