// One Windows entry point; the existing PowerShell lifecycle remains authoritative.
// No payload, credentials, client patches, provider fallback, or new service.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

internal static class RelayLauncher
{
    private sealed class Options
    {
        public string Command = "start", Model = "gpt-6.1-sol";
        public int Port = 4144;
        public bool NoDashboard, NoPause, PortSet, ModelSet;
    }
    private static Options Parse(string[] args)
    {
        var result = new Options();
        int i = 0;
        if (args.Length > 0 && !args[0].StartsWith("--", StringComparison.Ordinal))
            result.Command = args[i++].ToLowerInvariant();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        for (; i < args.Length; i++)
        {
            string arg = args[i];
            if (!seen.Add(arg)) throw new ArgumentException("Duplicate option. Use --help.");
            switch (arg)
            {
                case "--help": result.Command = "help"; break;
                case "--version": result.Command = "version"; break;
                case "--no-dashboard": result.NoDashboard = true; break;
                case "--no-pause": result.NoPause = true; break;
                case "--port":
                    if (++i >= args.Length || !Int32.TryParse(args[i], out result.Port) || result.Port < 1024 || result.Port > 65535)
                        throw new ArgumentException("Port must be between 1024 and 65535.");
                    result.PortSet = true; break;
                case "--model":
                    if (++i >= args.Length || !Regex.IsMatch(args[i], @"\A[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}\z"))
                        throw new ArgumentException("Invalid model identifier.");
                    result.Model = args[i]; result.ModelSet = true; break;
                default: throw new ArgumentException("Unknown option. Use --help.");
            }
        }
        if (!new HashSet<string> { "start", "stop", "status", "help", "version" }.Contains(result.Command))
            throw new ArgumentException("Use start, stop, status, --help or --version.");
        if (result.Command != "start" && (result.ModelSet || result.NoDashboard))
            throw new ArgumentException("--model and --no-dashboard apply only to start.");
        if (result.Command == "stop" && result.PortSet)
            throw new ArgumentException("Stop uses the protected managed state, not a supplied port.");
        return result;
    }
    // Windows argv quoting. No cmd.exe, shell command string, or -Command evaluation.
    private static string Quote(string value)
    {
        var output = new StringBuilder("\"");
        int slashes = 0;
        foreach (char c in value)
        {
            if (c == '\\') { slashes++; continue; }
            output.Append('\\', c == '"' ? slashes * 2 + 1 : slashes);
            output.Append(c); slashes = 0;
        }
        output.Append('\\', slashes * 2);
        return output.Append('"').ToString();
    }
    private static int RunLifecycle(Options options)
    {
        string root = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
        string script = Path.Combine(root, options.Command == "stop" ? "Stop-Relay.ps1" : "Start-Relay.ps1");
        if (!File.Exists(script))
            throw new InvalidOperationException("Keep Copilot-Relay.exe beside Start-Relay.ps1 and Stop-Relay.ps1. This is a launcher, not a standalone SDK bundle.");
        string powershell = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe");
        if (!File.Exists(powershell)) throw new InvalidOperationException("Windows PowerShell 5.1 is required.");
        var arguments = new List<string> { "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script };
        if (options.Command == "start")
        {
            arguments.AddRange(new[] { "-Port", options.Port.ToString(), "-Model", options.Model });
            if (options.NoDashboard) arguments.Add("-NoDashboard");
            Console.WriteLine("Starting shared Codex + Claude relay and its existing recovery/event terminal.");
            Console.WriteLine("Closing the event window triggers recovery. Use Stop & Restore for intentional shutdown.");
        }
        else
        {
            Console.WriteLine("Stop & Restore: drain active work, stop owned recovery/adapters, restore Codex TOML.");
            Console.WriteLine("Claude's saved Gateway profile stays unchanged; select normal sign-in in Claude yourself.");
        }
        var quoted = new List<string>();
        foreach (string argument in arguments) quoted.Add(Quote(argument));
        var start = new ProcessStartInfo(powershell, String.Join(" ", quoted))
        { WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = false };
        // PowerShell 7 can supply an incompatible module path to the stock 5.1 host.
        start.EnvironmentVariables.Remove("PSModulePath");
        using (var child = Process.Start(start)) { child.WaitForExit(); return child.ExitCode; }
    }
    private static string SafeLabel(object value)
    {
        string text = Convert.ToString(value);
        return Regex.IsMatch(text, @"\A[A-Za-z0-9._:/-]{1,128}\z") ? text : "unreported";
    }
    private static object Field(Dictionary<string, object> obj, string name)
    {
        object value;
        return obj != null && obj.TryGetValue(name, out value) ? value : null;
    }
    private static int Status(int port)
    {
        // Loopback only, no proxy, redirects, auth headers, raw bodies or writes.
        var request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + "/health");
        request.Proxy = null; request.AllowAutoRedirect = false;
        request.Timeout = 3000; request.ReadWriteTimeout = 3000;
        using (var response = (HttpWebResponse)request.GetResponse())
        using (var stream = response.GetResponseStream())
        using (var memory = new MemoryStream())
        {
            if (response.StatusCode != HttpStatusCode.OK) throw new InvalidOperationException("Relay health did not return HTTP 200.");
            byte[] buffer = new byte[4096]; int count;
            while ((count = stream.Read(buffer, 0, buffer.Length)) > 0)
            {
                if (memory.Length + count > 262144) throw new InvalidOperationException("Relay health response is oversized.");
                memory.Write(buffer, 0, count);
            }
            var json = new JavaScriptSerializer { MaxJsonLength = 262144, RecursionLimit = 32 };
            Dictionary<string, object> health;
            try { health = json.Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(memory.ToArray())); }
            catch (Exception) { throw new InvalidOperationException("Relay health returned invalid JSON."); }
            if (!Object.Equals(Field(health, "provider"), "github-copilot-sdk"))
                throw new InvalidOperationException("Port does not report a GitHub Copilot SDK relay.");
            var sdk = Field(health, "sdk") as Dictionary<string, object>;
            var claude = Field(health, "claude") as Dictionary<string, object>;
            Console.WriteLine("Live relay v" + SafeLabel(Field(health, "version")) + " | model=" + SafeLabel(Field(health, "model")));
            Console.WriteLine("Codex SDK=" + SafeLabel(Field(sdk, "state")) + " | Claude SDK=" + SafeLabel(Field(claude, "sdkState")) + " | active=" + SafeLabel(Field(health, "activeExchanges")));
            Console.WriteLine("Dashboard: http://127.0.0.1:" + port + "/dashboard");
            Console.WriteLine("Readiness is not proof of a client prompt/reply. No settings were changed.");
            return Object.Equals(Field(health, "ok"), true) && Object.Equals(Field(health, "unified"), true) && Object.Equals(Field(claude, "sdkState"), "ready") ? 0 : 3;
        }
    }
    private static void Pause()
    {
        try
        {
            if (!Console.IsInputRedirected && !Console.IsOutputRedirected)
            { Console.WriteLine("Press Enter to close this control window."); Console.ReadLine(); }
        }
        catch (InvalidOperationException) { }
    }
    public static int Main(string[] args)
    {
        Options options = null; int code;
        try
        {
            options = Parse(args);
            string version = Assembly.GetExecutingAssembly().GetName().Version.ToString(3);
            if (options.Command == "help")
            {
                Console.WriteLine("Copilot Relay launcher v" + version);
                Console.WriteLine("Copilot-Relay.exe [start|stop|status] [--no-pause]");
                Console.WriteLine("start: [--port 4144] [--model gpt-6.1-sol] [--no-dashboard]");
                Console.WriteLine("status: [--port 4144] (read-only). No arguments means start.");
                Console.WriteLine("Keep this EXE beside the installed relay source and dependencies (Node + npm ci).");
                Console.WriteLine("Close event terminal = recovery. stop = drain and restore Codex; Claude profile is manual.");
                return 0;
            }
            if (options.Command == "version") { Console.WriteLine(version); return 0; }
            code = options.Command == "status" ? Status(options.Port) : RunLifecycle(options);
            if (code != 0) Console.Error.WriteLine("Control did not complete successfully (exit " + code + "). No launcher provider fallback was attempted.");
        }
        catch (WebException)
        {
            Console.Error.WriteLine("Relay health is unreachable or not ready. No settings were changed. Run Start Relay or inspect local diagnostics.");
            code = 3;
        }
        catch (Exception error)
        {
            // Never print raw JSON errors, which may contain response fragments.
            Console.Error.WriteLine(error is ArgumentException || error is InvalidOperationException ? error.Message : "Launcher failed. Check local installation and diagnostics; no provider fallback was attempted.");
            code = 1;
        }
        if ((options == null || !options.NoPause) && (code != 0 || (options != null && options.Command == "stop"))) Pause();
        return code;
    }
}
