using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.NetworkInformation;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Collections.Generic;

internal static class Program {
    [STAThread] static int Main(string[] args) {
        bool first;
        using (var mutex = new Mutex(true, "Local\\Sellmepls.LocalLauncher", out first)) {
            if (!first) { MessageBox.Show("Лаунчер уже открыт. Найдите окно Sellmepls в панели задач.", "Sellmepls"); return 0; }
            if (args.Length == 1 && args[0] == "--self-test") return Launcher.SelfTest();
            Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new Launcher()); return 0;
        }
    }
}

internal sealed class Launcher : Form {
    readonly string root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
    readonly Label status = new Label(), hint = new Label();
    readonly Button start = new Button(), stop = new Button(), open = new Button(), logs = new Button();
    readonly RichTextBox output = new RichTextBox();
    readonly CheckBox openBrowser = new CheckBox();
    readonly List<string> secrets = new List<string>();
    readonly object logLock = new object();
    Process web, worker; Job job;
    bool busy, closing, external;
    readonly System.Windows.Forms.Timer heartbeat = new System.Windows.Forms.Timer();
    bool probing;
    string logFile;
    public Launcher() {
        Text = "Sellmepls — локальный запуск"; ClientSize = new Size(760, 510); MinimumSize = new Size(700, 480);
        StartPosition = FormStartPosition.CenterScreen; BackColor = Color.FromArgb(15,17,23); ForeColor = Color.White;
        Font = new Font("Segoe UI", 10F); AutoScaleMode = AutoScaleMode.Dpi;
        var title = new Label { Text="SELLMEPLS", Font=new Font("Segoe UI",22F,FontStyle.Bold), Location=new Point(24,20), AutoSize=true };
        status.SetBounds(26,75,700,28); status.Anchor=AnchorStyles.Left|AnchorStyles.Right|AnchorStyles.Top; status.Text="Готов к запуску"; status.ForeColor=Color.FromArgb(196,244,103);
        hint.SetBounds(26,108,700,48); hint.Anchor=status.Anchor; hint.Text="Сайт: http://localhost:3000\nОкно управляет только процессами, которые запустило само.";
        SetButton(start,"Запустить",26,170,130); SetButton(open,"Открыть сайт",168,170,150); SetButton(stop,"Остановить",330,170,135); SetButton(logs,"Показать логи",477,170,155);
        openBrowser.Text="Открывать сайт после запуска";openBrowser.Checked=true;openBrowser.SetBounds(26,221,500,30);
        output.SetBounds(26,265,708,210);output.Anchor=AnchorStyles.Left|AnchorStyles.Right|AnchorStyles.Top|AnchorStyles.Bottom;
        output.ReadOnly=true;output.BackColor=Color.FromArgb(23,26,34);output.ForeColor=Color.Gainsboro;output.BorderStyle=BorderStyle.None;output.Font=new Font("Consolas",9F);
        Controls.AddRange(new Control[]{title,status,hint,start,open,stop,logs,openBrowser,output});
        open.Enabled=false;stop.Enabled=false;
        Directory.CreateDirectory(Path.Combine(root,"logs")); logFile=Path.Combine(root,"logs","launcher-"+DateTime.Now.ToString("yyyyMMdd-HHmmss")+".log");
        ReadSecrets();
        start.Click+=async delegate { await StartSite(); }; stop.Click+=delegate { StopSite(); };
        open.Click+=delegate { OpenUrl(); };logs.Click+=delegate { OpenFile(Path.Combine(root,"logs")); };
        FormClosing+=delegate { closing=true;heartbeat.Stop();StopOwned(); };
        Shown+=async delegate { await StartSite(); };
        heartbeat.Interval=5000;heartbeat.Tick+=async delegate {if(busy||probing||closing)return;probing=true;try { var healthy=await Health();open.Enabled=healthy;if(web!=null&&web.HasExited){status.Text="Сайт остановился. Причина — в логе ниже.";StopOwned();start.Enabled=true;stop.Enabled=false;}
            else if(worker!=null&&worker.HasExited){status.Text="Сайт работает, но проверка оплат остановилась. Перезапустите сайт.";}
            else if(!healthy&&external){status.Text="Внешний сервер остановлен";external=false;start.Enabled=true;}
        } finally {probing=false;} };heartbeat.Start();
        Log("launcher","Папка проекта: "+root);
    }
    void SetButton(Button b,string text,int x,int y,int width){b.Text=text;b.SetBounds(x,y,width,38);b.FlatStyle=FlatStyle.Flat;b.BackColor=Color.FromArgb(33,38,48);b.ForeColor=Color.White;b.FlatAppearance.BorderColor=Color.FromArgb(65,73,88);}
    void ReadSecrets(){var file=Path.Combine(root,".env.local");if(!File.Exists(file))return;foreach(var line in File.ReadAllLines(file)){var i=line.IndexOf('=');if(i<1)continue;var key=line.Substring(0,i).Trim();var value=line.Substring(i+1).Trim().Trim('"','\'');if(!key.StartsWith("NEXT_PUBLIC_")&&value.Length>=12&&(key.Contains("KEY")||key.Contains("SECRET")||key.Contains("RPC")))secrets.Add(value);}}
    void Log(string source,string line){if(String.IsNullOrEmpty(line))return;foreach(var secret in secrets)line=line.Replace(secret,"[скрыто]");var text=DateTime.Now.ToString("HH:mm:ss")+" ["+source+"] "+line+Environment.NewLine;lock(logLock){try{File.AppendAllText(logFile,text,Encoding.UTF8);}catch(IOException){}}
        if(!closing&&IsHandleCreated){try{BeginInvoke((Action)delegate{if(output.TextLength>100000)output.Clear();output.AppendText(text);output.SelectionStart=output.TextLength;output.ScrollToCaret();});}catch(InvalidOperationException){}}
    }
    static string FindNode(){var paths=new[]{Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),"nodejs","node.exe"),Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Programs","nodejs","node.exe")};foreach(var p in paths)if(File.Exists(p))return p;foreach(var dir in (Environment.GetEnvironmentVariable("PATH")??"").Split(';')){try{var p=Path.Combine(dir.Trim('"'),"node.exe");if(File.Exists(p))return p;}catch(ArgumentException){}}throw new InvalidOperationException("Не найден Node.js. Установите Node.js 22.12 или новее и откройте лаунчер снова.");}
    static bool PortBusy(){foreach(var e in IPGlobalProperties.GetIPGlobalProperties().GetActiveTcpListeners())if(e.Port==3000)return true;return false;}
    static async Task<bool> Health(){try{var req=(HttpWebRequest)WebRequest.Create("http://127.0.0.1:3000/api/local-health");req.Proxy=null;req.Timeout=2500;req.ReadWriteTimeout=2500;using(var cancel=new CancellationTokenSource(2500)){using(cancel.Token.Register(()=>req.Abort()))using(var response=await req.GetResponseAsync())using(var reader=new StreamReader(response.GetResponseStream())){var text=await reader.ReadToEndAsync();return text.Contains("\"app\":\"sellmepls\"")&&text.Contains("\"status\":\"running\"");}}}catch{return false;}}
    Process Spawn(string node,string args,string label){var info=new ProcessStartInfo(node,args){WorkingDirectory=root,UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true,StandardOutputEncoding=Encoding.UTF8,StandardErrorEncoding=Encoding.UTF8};info.EnvironmentVariables.Remove("NODE_ENV");info.EnvironmentVariables["NEXT_TELEMETRY_DISABLED"]="1";var process=new Process{StartInfo=info};process.OutputDataReceived+=(s,e)=>Log(label,e.Data);process.ErrorDataReceived+=(s,e)=>Log(label,e.Data);if(!process.Start())throw new InvalidOperationException("Не удалось запустить "+label);try{job.Add(process);}catch{try{process.Kill();}catch{}process.Dispose();throw;}process.BeginOutputReadLine();process.BeginErrorReadLine();return process;}
    async Task StartSite(){if(busy||closing)return;busy=true;start.Enabled=false;stop.Enabled=false;open.Enabled=false;status.Text="Проверка проекта…";
        try{
            if(await Health()){external=true;status.Text="Сайт уже запущен другим процессом";hint.Text="http://localhost:3000 · состояние внешнего обработчика оплат неизвестно.\nЛаунчер не будет останавливать чужие процессы.";open.Enabled=true;if(openBrowser.Checked)OpenUrl();return;}
            if(PortBusy())throw new InvalidOperationException("Порт 3000 занят другим процессом. Закройте старый сервер и нажмите «Запустить». Лаунчер не меняет порт: он привязан к входу кошельком.");
            foreach(var file in new[]{"package.json",".env.local","node_modules/next/dist/bin/next","node_modules/tsx/dist/loader.mjs","scripts/worker.ts"})if(!File.Exists(Path.Combine(root,file)))throw new InvalidOperationException("Не найден "+file+". Лаунчер должен оставаться в папке проекта с установленными зависимостями и настройками.");
            var node=FindNode();job=new Job();
            web=Spawn(node,"node_modules/next/dist/bin/next dev --webpack --hostname 127.0.0.1 --port 3000","web");
            status.Text="Запускаю сайт… Первый запуск может занять несколько минут.";
            var deadline=DateTime.UtcNow.AddMinutes(4);bool ready=false;
            while(DateTime.UtcNow<deadline&&!closing){if(web.HasExited)throw new InvalidOperationException("Сервер завершился с кодом "+web.ExitCode+". Посмотрите журнал.");if(await Health()){ready=true;break;}await Task.Delay(1000);}
            if(closing)return;if(!ready)throw new InvalidOperationException("Сайт не ответил за 4 минуты. Посмотрите журнал и повторите запуск.");
            worker=Spawn(node,"--import tsx --conditions=react-server scripts/worker.ts","payments");await Task.Delay(800);if(worker.HasExited)throw new InvalidOperationException("Обработчик оплат не запустился. Проверьте .env.local и журнал.");
            status.Text="Сайт и обработчик оплат работают";hint.Text="http://localhost:3000 · только этот компьютер.\nПри закрытии лаунчера сайт и обработчик оплат остановятся.";stop.Enabled=true;open.Enabled=true;Log("launcher","Готово: http://localhost:3000");if(openBrowser.Checked)OpenUrl();
        }catch(Exception error){status.Text="Не удалось запустить";Log("launcher",error.Message);StopOwned();start.Enabled=true;}finally{busy=false;}
    }
    void StopOwned(){if(job!=null){job.Dispose();job=null;}if(web!=null){web.Dispose();web=null;}if(worker!=null){worker.Dispose();worker=null;}}
    void StopSite(){if(busy)return;StopOwned();external=false;status.Text="Остановлено";start.Enabled=true;stop.Enabled=false;open.Enabled=false;Log("launcher","Собственные процессы остановлены.");}
    void OpenUrl(){OpenFile("http://localhost:3000/");}
    void OpenFile(string value){try{Process.Start(new ProcessStartInfo(value){UseShellExecute=true});}catch(Exception e){Log("launcher","Не удалось открыть: "+e.Message);}}
    public static int SelfTest(){var folder=AppDomain.CurrentDomain.BaseDirectory;var result=Path.Combine(folder,"logs","launcher-self-test.txt");Directory.CreateDirectory(Path.GetDirectoryName(result));try{
        var node=FindNode();Process p;using(var job=new Job()){p=Process.Start(new ProcessStartInfo(node,"-e \"setInterval(function(){},1000)\""){UseShellExecute=false,CreateNoWindow=true});job.Add(p);if(p.HasExited)throw new Exception("Child process exited before ownership test");}if(!p.WaitForExit(5000))throw new Exception("Child process survived job close");p.Dispose();File.WriteAllText(result,"PASS: Node found; owned child terminated on job close. UI not tested by this check.");return 0;
    }catch(Exception e){File.WriteAllText(result,"FAIL: "+e.Message);return 1;}}
}

// A Windows Job Object closes only this launcher's own process tree, including Next's child workers.
internal sealed class Job : IDisposable {
    IntPtr handle;
    public Job(){handle=CreateJobObject(IntPtr.Zero,null);if(handle==IntPtr.Zero)throw new System.ComponentModel.Win32Exception();var info=new Extended();info.Basic.LimitFlags=0x2000;int size=Marshal.SizeOf(typeof(Extended));var ptr=Marshal.AllocHGlobal(size);try{Marshal.StructureToPtr(info,ptr,false);if(!SetInformationJobObject(handle,9,ptr,(uint)size)){CloseHandle(handle);handle=IntPtr.Zero;throw new System.ComponentModel.Win32Exception();}}finally{Marshal.FreeHGlobal(ptr);}}
    public void Add(Process p){if(!AssignProcessToJobObject(handle,p.Handle))throw new System.ComponentModel.Win32Exception();}
    public void Dispose(){if(handle!=IntPtr.Zero){CloseHandle(handle);handle=IntPtr.Zero;}}
    [StructLayout(LayoutKind.Sequential)] struct Basic {public long PerProcessUserTimeLimit,PerJobUserTimeLimit;public uint LimitFlags;public UIntPtr MinimumWorkingSetSize,MaximumWorkingSetSize;public uint ActiveProcessLimit;public UIntPtr Affinity;public uint PriorityClass,SchedulingClass;}
    [StructLayout(LayoutKind.Sequential)] struct Io {public ulong ReadOperationCount,WriteOperationCount,OtherOperationCount,ReadTransferCount,WriteTransferCount,OtherTransferCount;}
    [StructLayout(LayoutKind.Sequential)] struct Extended {public Basic Basic;public Io Io;public UIntPtr ProcessMemoryLimit,JobMemoryLimit,PeakProcessMemoryUsed,PeakJobMemoryUsed;}
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr a,string name);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr h,int c,IntPtr p,uint n);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr h,IntPtr p);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
}
