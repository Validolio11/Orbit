using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

internal static class MouseHook
{
    private const int WH_MOUSE_LL = 14, WM_QUIT = 0x0012, WM_LBUTTONDOWN = 0x0201, WM_RBUTTONDOWN = 0x0204, WM_MBUTTONDOWN = 0x0207, WM_XBUTTONDOWN = 0x020B, WM_XBUTTONUP = 0x020C;
    private static readonly ConcurrentQueue<string> Events = new ConcurrentQueue<string>();
    private static readonly AutoResetEvent WakeWriter = new AutoResetEvent(false);
    private static readonly HookProc Callback = OnMouse;
    private static volatile bool Running = true;
    private static IntPtr Hook = IntPtr.Zero;
    private static uint MainThread;
    private static int SelectedButton = 4;

    [StructLayout(LayoutKind.Sequential)] private struct POINT { public int x, y; }
    [StructLayout(LayoutKind.Sequential)] private struct MSLLHOOKSTRUCT { public POINT pt; public uint mouseData, flags, time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] private struct MSG { public IntPtr hwnd; public uint message; public UIntPtr wParam; public IntPtr lParam; public uint time; public POINT pt; }
    [StructLayout(LayoutKind.Sequential)] private struct INPUT { public uint type; public INPUTUNION value; }
    [StructLayout(LayoutKind.Explicit)] private struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mouse; [FieldOffset(0)] public KEYBDINPUT keyboard; }
    [StructLayout(LayoutKind.Sequential)] private struct MOUSEINPUT { public int dx, dy; public uint mouseData, flags, time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] private struct KEYBDINPUT { public ushort key, scan; public uint flags, time; public UIntPtr extra; }
    private delegate IntPtr HookProc(int code, IntPtr message, IntPtr data);
    [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr SetWindowsHookEx(int id, HookProc proc, IntPtr module, uint thread);
    [DllImport("user32.dll")] private static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] private static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);
    [DllImport("user32.dll")] private static extern int GetMessage(out MSG message, IntPtr hwnd, uint min, uint max);
    [DllImport("user32.dll")] private static extern bool PeekMessage(out MSG message, IntPtr hwnd, uint min, uint max, uint remove);
    [DllImport("user32.dll")] private static extern bool PostThreadMessage(uint thread, uint message, UIntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", SetLastError = true)] private static extern uint SendInput(uint count, INPUT[] inputs, int size);
    [DllImport("user32.dll")] private static extern bool LockWorkStation();
    [DllImport("user32.dll")] private static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("kernel32.dll")] private static extern IntPtr GetModuleHandle(string name);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();

    private static int Main(string[] args)
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        if (Array.IndexOf(args, "--self-test") >= 0) return RunSelfTest();
        foreach (string arg in args) if (arg.StartsWith("--action=")) return DoAction(arg.Substring(9));
        int parentId = 0;
        foreach (string arg in args)
        {
            if (arg.StartsWith("--button=") && !int.TryParse(arg.Substring(9), out SelectedButton)) return 2;
            if (arg.StartsWith("--parent-pid=")) int.TryParse(arg.Substring(13), out parentId);
        }
        if (SelectedButton != 0 && SelectedButton != 4 && SelectedButton != 5) return 2;
        try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch (EntryPointNotFoundException) { }
        MainThread = GetCurrentThreadId();
        MSG message;
        PeekMessage(out message, IntPtr.Zero, 0, 0, 0);
        Hook = SetWindowsHookEx(WH_MOUSE_LL, Callback, GetModuleHandle(null), 0);
        if (Hook == IntPtr.Zero) { Console.Error.WriteLine("Unable to install mouse hook: " + Marshal.GetLastWin32Error()); return 3; }
        var writer = new Thread(WriteEvents); writer.IsBackground = true; writer.Start();
        var input = new Thread(delegate() { try { while (Console.ReadLine() != null) { RequestStop(); break; } } catch { } RequestStop(); });
        input.IsBackground = true; input.Start();
        Timer watchdog = null;
        if (parentId > 0)
        {
            int owner = parentId;
            watchdog = new Timer(delegate(object unused) { try { using (var process = Process.GetProcessById(owner)) if (process.HasExited) RequestStop(); } catch { RequestStop(); } }, null, 1000, 1000);
        }
        Enqueue("{\"type\":\"ready\",\"button\":" + SelectedButton + "}");
        try { while (GetMessage(out message, IntPtr.Zero, 0, 0) > 0) { } }
        finally { Running = false; if (Hook != IntPtr.Zero) UnhookWindowsHookEx(Hook); Hook = IntPtr.Zero; if (watchdog != null) watchdog.Dispose(); WakeWriter.Set(); writer.Join(500); }
        return 0;
    }

    private static IntPtr OnMouse(int code, IntPtr message, IntPtr data)
    {
        long kind = message.ToInt64();
        if (code >= 0 && (kind == WM_LBUTTONDOWN || kind == WM_RBUTTONDOWN || kind == WM_MBUTTONDOWN || kind == WM_XBUTTONDOWN || kind == WM_XBUTTONUP))
        {
            var mouse = (MSLLHOOKSTRUCT)Marshal.PtrToStructure(data, typeof(MSLLHOOKSTRUCT));
            if (InspectMouse(kind, mouse)) return new IntPtr(1);
        }
        return CallNextHookEx(Hook, code, message, data);
    }

    // Returns true only when this event must be consumed by Orbit.
    private static bool InspectMouse(long kind, MSLLHOOKSTRUCT mouse)
    {
        if (kind == WM_LBUTTONDOWN || kind == WM_RBUTTONDOWN || kind == WM_MBUTTONDOWN)
        {
            string button = kind == WM_LBUTTONDOWN ? "left" : kind == WM_RBUTTONDOWN ? "right" : "middle";
            Enqueue("{\"type\":\"click\",\"x\":" + mouse.pt.x + ",\"y\":" + mouse.pt.y + ",\"button\":\"" + button + "\"}");
            // Observation only: ordinary clicks always continue through the native hook chain.
            return false;
        }
        if (kind == WM_XBUTTONDOWN || kind == WM_XBUTTONUP)
        {
            int button = (int)((mouse.mouseData >> 16) & 0xffff) + 3;
            if (button == SelectedButton)
            {
                Enqueue("{\"type\":\"" + (kind == WM_XBUTTONDOWN ? "down" : "up") + "\",\"x\":" + mouse.pt.x + ",\"y\":" + mouse.pt.y + ",\"button\":" + button + "}");
                return true;
            }
        }
        return false;
    }

    private static int RunSelfTest()
    {
        // Exercise the same event decision code as the native callback, without installing
        // a hook, injecting input, moving the cursor, or invoking any system action.
        var mouse = new MSLLHOOKSTRUCT { pt = new POINT { x = 120, y = -80 } };
        bool passed = true;
        SelectedButton = 0;
        passed &= !InspectMouse(WM_LBUTTONDOWN, mouse);
        passed &= !InspectMouse(WM_RBUTTONDOWN, mouse);
        passed &= !InspectMouse(WM_MBUTTONDOWN, mouse);
        for (int button = 4; button <= 5; button++)
        {
            mouse.mouseData = (uint)((button - 3) << 16);
            passed &= !InspectMouse(WM_XBUTTONDOWN, mouse);
            passed &= !InspectMouse(WM_XBUTTONUP, mouse);
            SelectedButton = button;
            passed &= InspectMouse(WM_XBUTTONDOWN, mouse);
            passed &= InspectMouse(WM_XBUTTONUP, mouse);
            mouse.mouseData = (uint)((button == 4 ? 2 : 1) << 16);
            passed &= !InspectMouse(WM_XBUTTONDOWN, mouse);
            SelectedButton = 0;
        }
        string value;
        int events = 0, normalClicks = 0;
        bool left = false, right = false, middle = false;
        while (Events.TryDequeue(out value))
        {
            events++;
            if (value.Contains("\"type\":\"click\"") && value.Contains("\"x\":120") && value.Contains("\"y\":-80"))
            {
                normalClicks++;
                left |= value.Contains("\"button\":\"left\"");
                right |= value.Contains("\"button\":\"right\"");
                middle |= value.Contains("\"button\":\"middle\"");
            }
        }
        passed &= events == 7 && normalClicks == 3 && left && right && middle;
        if (!passed) { Console.Error.WriteLine("Mouse event self-test failed."); return 5; }
        Console.WriteLine("{\"ok\":true,\"architecture\":\"x64\",\"buttons\":[4,5],\"outsideWatcher\":true,\"normalClicksPassThrough\":true,\"watcherPassesSideButtons\":true}");
        return 0;
    }

    private static void Enqueue(string value) { Events.Enqueue(value); WakeWriter.Set(); }
    private static void WriteEvents()
    {
        try { while (Running || !Events.IsEmpty) { string value; while (Events.TryDequeue(out value)) Console.WriteLine(value); WakeWriter.WaitOne(100); } }
        catch { RequestStop(); }
    }
    private static void RequestStop() { PostThreadMessage(MainThread, WM_QUIT, UIntPtr.Zero, IntPtr.Zero); }

    private static int DoAction(string action)
    {
        if (action == "lock") return LockWorkStation() ? 0 : 4;
        ushort[] keys;
        switch (action)
        {
            case "screenshot": keys = new ushort[] { 0x5B, 0x10, 0x53 }; break;
            case "desktop": keys = new ushort[] { 0x5B, 0x44 }; break;
            case "mute": keys = new ushort[] { 0xAD }; break;
            case "volume-up": keys = new ushort[] { 0xAF }; break;
            case "volume-down": keys = new ushort[] { 0xAE }; break;
            case "media-play": keys = new ushort[] { 0xB3 }; break;
            default: Console.Error.WriteLine("Unsupported system action."); return 2;
        }
        var inputs = new INPUT[keys.Length * 2];
        for (int index = 0; index < keys.Length; index++)
        {
            inputs[index].type = 1; inputs[index].value.keyboard.key = keys[index];
            inputs[keys.Length + index].type = 1; inputs[keys.Length + index].value.keyboard.key = keys[keys.Length - index - 1]; inputs[keys.Length + index].value.keyboard.flags = 2;
        }
        return SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT))) == inputs.Length ? 0 : 4;
    }
}
