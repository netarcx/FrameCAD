using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using Microsoft.Win32;
using SolidWorks.Interop.sldworks;
using SolidWorks.Interop.swconst;
using SolidWorks.Interop.swpublished;

namespace TrentCAD.SolidWorksAddin
{
    [ComVisible(true)]
    [Guid("8A3F4B2E-1C5D-4E6F-9A7B-2D3E4F5A6B7C")]
    public class SwAddin : ISwAddin
    {
        private ISldWorks _swApp;
        private SldWorks _swEvents;
        private int _addinCookie;
        private TaskPaneControl _taskPaneControl;
        private ITaskpaneView _taskPaneView;
        private TaskPaneHost _taskPaneHost;

        [ComRegisterFunction]
        public static void RegisterFunction(Type t)
        {
            var keyPath = @"SOFTWARE\SolidWorks\AddIns\" + t.GUID.ToString("B");
            using (var key = Registry.LocalMachine.CreateSubKey(keyPath))
            {
                key.SetValue(null, 1);
                key.SetValue("Description", "TrentCAD - CAD Collaboration for FRC 2129");
                key.SetValue("Title", "TrentCAD");
            }
        }

        [ComUnregisterFunction]
        public static void UnregisterFunction(Type t)
        {
            var keyPath = @"SOFTWARE\SolidWorks\AddIns\" + t.GUID.ToString("B");
            Registry.LocalMachine.DeleteSubKey(keyPath, false);
        }

        public bool ConnectToSW(object ThisSW, int Cookie)
        {
            _swApp = (ISldWorks)ThisSW;
            _swEvents = (SldWorks)ThisSW;
            _addinCookie = Cookie;

            _swEvents.ActiveDocChangeNotify += OnActiveDocChange;
            _swEvents.FileSavePostNotify += OnFileSavePost;

            CreateTaskPane();
            _taskPaneControl?.StartHealthPolling();

            OnActiveDocChange();

            return true;
        }

        public bool DisconnectFromSW()
        {
            _swEvents.ActiveDocChangeNotify -= OnActiveDocChange;
            _swEvents.FileSavePostNotify -= OnFileSavePost;

            _taskPaneControl?.StopHealthPolling();
            _taskPaneHost?.ReleaseHandle();
            _taskPaneView?.DeleteView();
            _taskPaneControl?.Dispose();

            _swApp = null;
            _swEvents = null;
            _taskPaneHost = null;
            return true;
        }

        private void CreateTaskPane()
        {
            _taskPaneControl = new TaskPaneControl();
            _taskPaneControl.OnProjectPathChanged = SetSolidWorksWorkingDirectory;
            _taskPaneControl.OnCreateSolidWorksFile = CreateSolidWorksFile;
            _taskPaneControl.OnStageFile = StageFileViaApi;
            _taskPaneControl.OnGetAssemblyChildren = GetAssemblyChildren;
            _taskPaneView = _swApp.CreateTaskpaneView2("", "TrentCAD");

            if (_taskPaneView != null)
            {
                _taskPaneView.DisplayWindowFromHandlex64(_taskPaneControl.Handle.ToInt64());
                var parentHwnd = (IntPtr)_taskPaneView.GetTaskpaneViewWndx64();
                _taskPaneHost = new TaskPaneHost(parentHwnd, _taskPaneControl);
            }
        }

        private void SetSolidWorksWorkingDirectory(string path)
        {
            if (_swApp == null || string.IsNullOrEmpty(path)) return;
            try
            {
                _swApp.SetCurrentWorkingDirectory(path);
            }
            catch
            {
                // SolidWorks may reject the call if the path is invalid; ignore silently
            }
        }

        private System.Collections.Generic.List<string> GetAssemblyChildren(string assemblyPath)
        {
            var result = new System.Collections.Generic.List<string>();
            if (_swApp == null || string.IsNullOrEmpty(assemblyPath)) return result;
            try
            {
                var doc = _swApp.ActiveDoc as ModelDoc2;
                if (doc == null) return result;
                if (!string.Equals(doc.GetPathName(), assemblyPath, StringComparison.OrdinalIgnoreCase))
                    return result;
                var asm = doc as AssemblyDoc;
                if (asm == null) return result;
                var components = asm.GetComponents(false) as object[];
                if (components == null) return result;
                foreach (var c in components)
                {
                    var comp = c as Component2;
                    if (comp == null) continue;
                    var path = comp.GetPathName();
                    if (!string.IsNullOrEmpty(path) && !result.Contains(path, StringComparer.OrdinalIgnoreCase))
                        result.Add(path);
                }
            }
            catch { /* SW API rejected — return what we have */ }
            return result;
        }

        private string CreateSolidWorksFile(string absolutePath, bool isAssembly)
        {
            if (_swApp == null) return "SolidWorks not connected";
            if (string.IsNullOrEmpty(absolutePath)) return "Empty target path";
            try
            {
                // NewPart/NewAssembly use the default template configured in
                // SolidWorks options. Fall back to NewDocument with the
                // explicit template path if the simple call fails.
                object created = isAssembly ? _swApp.NewAssembly() : _swApp.NewPart();
                if (created == null)
                {
                    var templateKey = isAssembly
                        ? (int)swUserPreferenceStringValue_e.swDefaultTemplateAssembly
                        : (int)swUserPreferenceStringValue_e.swDefaultTemplatePart;
                    var template = _swApp.GetUserPreferenceStringValue(templateKey);
                    if (string.IsNullOrEmpty(template))
                        return "No default " + (isAssembly ? "assembly" : "part") + " template configured in SolidWorks (Tools > Options > File Locations)";
                    if (!File.Exists(template))
                        return "Configured template not found: " + template;
                    created = _swApp.NewDocument(template, 0, 0, 0);
                    if (created == null) return "SolidWorks refused to create document from template";
                }

                var doc = created as ModelDoc2;
                if (doc == null) return "Unexpected document type from SolidWorks";

                var dir = Path.GetDirectoryName(absolutePath);
                if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
                    Directory.CreateDirectory(dir);

                int errors = 0, warnings = 0;
                var saved = doc.Extension.SaveAs(
                    absolutePath,
                    (int)swSaveAsVersion_e.swSaveAsCurrentVersion,
                    (int)swSaveAsOptions_e.swSaveAsOptions_Silent,
                    null,
                    ref errors,
                    ref warnings);
                if (!saved) return "SaveAs failed (errors=" + errors + " warnings=" + warnings + ")";
                if (!File.Exists(absolutePath)) return "SolidWorks reported success but file is missing on disk";
                return null;
            }
            catch (Exception ex)
            {
                return ex.Message;
            }
        }

        private async System.Threading.Tasks.Task StageFileViaApi(string relativePath)
        {
            // Tell TrentCAD to git-add the new file so it's actively tracked
            try
            {
                using (var client = new System.Net.Http.HttpClient(
                    new System.Net.Http.HttpClientHandler { UseProxy = false, Proxy = null }))
                {
                    client.Timeout = TimeSpan.FromSeconds(5);
                    var json = Newtonsoft.Json.JsonConvert.SerializeObject(new { path = relativePath });
                    var content = new System.Net.Http.StringContent(json, System.Text.Encoding.UTF8, "application/json");
                    await client.PostAsync("http://127.0.0.1:42129/api/stage", content);
                }
            }
            catch
            {
                // Best-effort - file will still show up as untracked
            }
        }

        private int OnFileSavePost(int saveType, string fileName)
        {
            // After a save, push the doc's current mass (from SW's mass-properties
            // engine) to TrentCAD so the project totals update without manual
            // entry. Done best-effort — any failure is silent.
            if (string.IsNullOrEmpty(fileName) || _swApp == null) return 0;
            try
            {
                var doc = _swApp.ActiveDoc as ModelDoc2;
                if (doc == null) return 0;
                // Only push for the file that was actually saved
                if (!string.Equals(doc.GetPathName(), fileName, StringComparison.OrdinalIgnoreCase))
                    return 0;
                // GetMassProperties2's third arg (UseSystemUnits=true) forces
                // SI units (kg) regardless of the document's MMGS / IPS / CGS
                // configuration, so the kg→lb conversion below is correct for
                // every user's SolidWorks setup. Available in SW 2010+, stable
                // through SW 2025.
                int errors = 0;
                var props = doc.Extension.GetMassProperties2(1, out errors, true) as double[];
                if (props == null || props.Length < 6) return 0;
                var massKg = props[5];
                if (massKg <= 0) return 0;
                var massLb = massKg * 2.20462262;
                // POST to local TrentCAD API. Best effort, fire and forget.
                System.Threading.Tasks.Task.Run(async () =>
                {
                    try
                    {
                        using (var client = new System.Net.Http.HttpClient(
                            new System.Net.Http.HttpClientHandler { UseProxy = false, Proxy = null }))
                        {
                            client.Timeout = TimeSpan.FromSeconds(5);
                            // Convert SW's absolute path to TrentCAD's relative path
                            // via /api/health (which reports the project root)
                            var healthResp = await client.GetAsync("http://127.0.0.1:42129/api/health");
                            if (!healthResp.IsSuccessStatusCode) return;
                            var healthJson = await healthResp.Content.ReadAsStringAsync();
                            // Crude string parse to avoid bringing Json into this file
                            var rootMatch = System.Text.RegularExpressions.Regex.Match(
                                healthJson, "\"path\"\\s*:\\s*\"([^\"]+)\"");
                            if (!rootMatch.Success) return;
                            var projectRoot = rootMatch.Groups[1].Value.Replace("\\\\", "\\");
                            var norm = fileName.Replace("\\", "/");
                            var root = projectRoot.Replace("\\", "/").TrimEnd('/') + "/";
                            if (!norm.StartsWith(root, StringComparison.OrdinalIgnoreCase)) return;
                            var rel = norm.Substring(root.Length);
                            var body = $"{{\"path\":\"{rel.Replace("\\", "\\\\").Replace("\"", "\\\"")}\",\"mass\":{massLb:F4}}}";
                            var content = new System.Net.Http.StringContent(
                                body, System.Text.Encoding.UTF8, "application/json");
                            await client.PostAsync("http://127.0.0.1:42129/api/part-mass-auto", content);
                        }
                    }
                    catch { /* best effort */ }
                });
            }
            catch { /* SW API rejected — skip */ }
            return 0;
        }

        private int OnActiveDocChange()
        {
            var doc = _swApp.ActiveDoc as ModelDoc2;
            if (doc != null)
            {
                _taskPaneControl?.UpdateForDocument(doc.GetPathName());
            }
            else
            {
                _taskPaneControl?.ClearDocument();
            }
            return 0;
        }
    }

    internal class TaskPaneHost : NativeWindow
    {
        private const int WM_SIZE = 0x0005;
        private readonly Control _child;

        [DllImport("user32.dll")]
        private static extern bool GetClientRect(IntPtr hWnd, out RECT lpRect);

        [StructLayout(LayoutKind.Sequential)]
        private struct RECT { public int Left, Top, Right, Bottom; }

        public TaskPaneHost(IntPtr hwnd, Control child)
        {
            _child = child;
            AssignHandle(hwnd);
            FitChild();
        }

        protected override void WndProc(ref Message m)
        {
            base.WndProc(ref m);
            if (m.Msg == WM_SIZE)
                FitChild();
        }

        private void FitChild()
        {
            if (GetClientRect(Handle, out var rect))
                _child.SetBounds(0, 0, rect.Right, rect.Bottom);
        }
    }
}
