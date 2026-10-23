import { useState } from "react";
import { Bluetooth, ChevronDown, ChevronUp, CircleCheck, Clock3, Cpu, ShieldCheck, Wifi, X } from "lucide-react";
import { normalizeReminderTimes } from "../lib/reminders.js";

/** Future hardware concept only: this component must never claim to trigger a physical dispenser. */
export default function SmartDispenserPanel({ medications = [], autoExpand = false }) {
  const [expanded, setExpanded] = useState(autoExpand);
  const [connectOpen, setConnectOpen] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState("");
  const [connecting, setConnecting] = useState(false);
  const rows = medications.filter((med) => med?.name?.trim());
  const schedules = rows.flatMap((med) => normalizeReminderTimes(med.reminder_times)
    .map((time) => ({ name: med.name, dosage: med.dosage || "", frequency: med.frequency || "", time })));
  const readyCount = schedules.filter((item) => item.dosage && item.frequency).length;

  async function openBluetooth() {
    setConnectionStatus("");
    const native = window.XiaonuanNative;
    if (native?.openBluetoothSettings) {
      native.openBluetoothSettings();
      setConnectionStatus("已打开安卓蓝牙设置。开启蓝牙并配对改造设备后，返回小暖。系统配对完成后仍需接入设备控制协议。 ");
      return;
    }
    if (!navigator.bluetooth?.requestDevice) {
      setConnectionStatus("当前浏览器不能发起蓝牙配对。请在小暖 Android App 中使用此入口。 ");
      return;
    }
    setConnecting(true);
    try {
      const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: [] });
      if (!device.gatt) throw new Error("该设备不支持网页蓝牙 GATT 连接，请使用 Android App 或确认设备协议。");
      await device.gatt.connect();
      setConnectionStatus(`已建立与${device.name || "蓝牙设备"}的基础连接；设备控制协议尚未接入，暂不能启动泡药或泡茶。`);
      device.addEventListener("gattserverdisconnected", () => setConnectionStatus("蓝牙设备已断开。"), { once: true });
    } catch (error) {
      setConnectionStatus(error?.name === "NotFoundError" ? "已取消蓝牙配对。" : (error?.message || "蓝牙连接失败，请重试。"));
    } finally {
      setConnecting(false);
    }
  }

  function openWifi() {
    setConnectionStatus("");
    const native = window.XiaonuanNative;
    if (native?.openWifiSettings) {
      native.openWifiSettings();
      setConnectionStatus("已打开安卓 Wi‑Fi 设置。请连接设备要求的网络后返回小暖；网络连接完成后仍需接入设备控制协议。 ");
    } else {
      setConnectionStatus("网页无法替系统打开 Wi‑Fi 设置。请在 Android App 中使用此入口，或手动进入手机设置连接设备网络。 ");
    }
  }

  return (
    <section className="rounded-2xl border border-[#dce8e7] bg-white/80 p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#edf6f4] text-[#287f80]">
          <Cpu size={20} strokeWidth={1.8} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[14px] font-medium text-[#19383f]">智能泡药 · 健康茶设备</h3>
            <span className="rounded-full bg-[#fff4e6] px-2 py-0.5 text-[11px] font-medium text-[#936b3f]">未连接</span>
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-[#769092]">
            泡药按用药提醒准备任务；健康茶可按指令或习惯计划，接入设备后再执行。
          </p>
          <button type="button" onClick={() => setConnectOpen(true)}
            className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-[#287f80] px-3 text-[13px] font-medium text-white hover:bg-[#236f72]">
            <Bluetooth size={15} />连接硬件
          </button>
          <button type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}
            className="mt-2 inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-[13px] font-medium text-[#287f80] hover:bg-[#edf6f4]">
            {expanded ? "收起准备清单" : "查看设备准备清单"}{expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>
      {expanded && (
        <div className="mt-3 space-y-3 border-t border-dashed border-[#dce8e7] pt-3">
          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="rounded-xl bg-[#f4f8f7] px-2 py-2.5">
              <p className="text-[18px] font-semibold text-[#287f80]">{schedules.length}</p>
              <p className="text-[11px] text-[#769092]">有提醒时间的药品任务</p>
            </div>
            <div className="rounded-xl bg-[#f4f8f7] px-2 py-2.5">
              <p className="text-[18px] font-semibold text-[#287f80]">{readyCount}/{schedules.length}</p>
              <p className="text-[11px] text-[#769092]">有剂量和频次</p>
            </div>
          </div>
          {schedules.length ? (
            <div className="space-y-2">
              {schedules.map((item, index) => {
                const complete = !!item.dosage && !!item.frequency;
                return (
                  <div key={`${item.name}-${item.time}-${index}`} className="flex items-start gap-2 rounded-xl bg-[#f8faf9] px-3 py-2.5 text-[13px]">
                    {complete ? <CircleCheck size={16} className="mt-0.5 shrink-0 text-[#318a89]" /> : <Clock3 size={16} className="mt-0.5 shrink-0 text-[#b2844d]" />}
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-[#315b60]">{item.time} · {item.name}</p>
                      <p className="mt-0.5 leading-5 text-[#769092]">{[item.dosage, item.frequency].filter(Boolean).join(" · ") || "请核对并补充剂量、服用频次"}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="rounded-xl bg-[#f8faf9] px-3 py-2.5 text-[13px] leading-5 text-[#769092]">
              先通过聊天或拍照整理用药信息，再核对并设置提醒时间；泡药任务会从这些记录生成待确认计划。
            </p>
          )}
          <div className="rounded-xl border border-[#dce8e7] bg-[#f8faf9] px-3.5 py-3">
            <p className="text-[13px] font-medium text-[#315b60]">健康茶计划</p>
            <p className="mt-1 text-[12px] leading-5 text-[#769092]">设备接入后，可说“泡一壶健康茶”临时启动，或根据家中习惯设置固定时段。茶种、用水量和温度由家人设置并确认。</p>
          </div>
          <div className="flex items-start gap-2 rounded-xl border border-[#f1dfc8] bg-[#fff8ef] px-3 py-2.5 text-[12px] leading-5 text-[#805f43]">
            <ShieldCheck size={16} className="mt-0.5 shrink-0" />
            <p>目前没有接入实体设备，不会实际泡药或泡茶。泡药还需依照医生/药房确认的处方参数，由本人或家属核对；普通药盒照片和提醒时间不足以生成煎煮指令。</p>
          </div>
        </div>
      )}
      {connectOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#19383f]/55 p-5 backdrop-blur-sm" onClick={() => setConnectOpen(false)}>
          <section role="dialog" aria-modal="true" aria-labelledby="device-connect-title" className="w-full max-w-[380px] rounded-[26px] border border-white/80 bg-[#f9fbfb] p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <header className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#e3f1ee] text-[#287f80]"><Cpu size={22} /></div>
                <div>
                  <h3 id="device-connect-title" className="text-[17px] font-semibold text-[#19383f]">连接泡药 / 泡茶设备</h3>
                  <p className="mt-0.5 text-[12px] text-[#9a7955]">当前状态：未连接</p>
                </div>
              </div>
              <button type="button" aria-label="关闭" onClick={() => setConnectOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-[#688184]"><X size={18} /></button>
            </header>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button type="button" onClick={openBluetooth} disabled={connecting} className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-[#b9d8d3] bg-white p-3 text-[14px] font-medium text-[#287f80] hover:bg-[#edf6f4] disabled:opacity-60"><Bluetooth size={18} />{connecting ? "等待选择设备…" : "蓝牙连接"}</button>
              <button type="button" onClick={openWifi} className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-[#b9d8d3] bg-white p-3 text-[14px] font-medium text-[#287f80] hover:bg-[#edf6f4]"><Wifi size={18} />打开 Wi-Fi 设置</button>
            </div>
            {connectionStatus && <p role="status" className="mt-3 rounded-xl bg-[#edf6f4] px-3.5 py-3 text-[12px] leading-5 text-[#547477]">{connectionStatus}</p>}
            <p className="mt-3 rounded-xl bg-[#fff8ef] px-3.5 py-3 text-[13px] leading-5 text-[#805f43]">
              蓝牙会打开安卓系统设置（网页可用时会弹出附近蓝牙设备选择器）；Wi-Fi 会打开安卓网络设置。配对/入网只是连接准备，自动泡药和泡茶还需设备控制协议与安全指令。
            </p>
            <button type="button" onClick={() => setConnectOpen(false)} className="mt-4 h-11 w-full rounded-xl bg-[#287f80] text-[14px] font-medium text-white">知道了</button>
          </section>
        </div>
      )}
    </section>
  );
}
