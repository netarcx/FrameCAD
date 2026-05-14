using System;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using Microsoft.Win32;
using SolidWorks.Interop.sldworks;
using SolidWorks.Interop.swconst;
using SolidWorks.Interop.swpublished;

namespace FrameCAD.SolidWorksAddin
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

        // Per-doc FileSavePostNotify hook used by mass auto-push. The
        // SldWorks co-class doesn't expose FileSavePostNotify directly —
        // only PartDoc/AssemblyDoc/DrawingDoc do — so we re-hook every
        // time the active document changes. The delegate is stored so
        // we can `-=` it before re-hooking on the next doc; otherwise
        // handlers leak and every save fires N times for the N docs
        // the user has opened this session.
        private PartDoc _massHookPart;
        private DPartDocEvents_FileSavePostNotifyEventHandler _massHookHandler;

        [ComRegisterFunction]
        public static void RegisterFunction(Type t)
        {
            var keyPath = @"SOFTWARE\SolidWorks\AddIns\" + t.GUID.ToString("B");
            using (var key = Registry.LocalMachine.CreateSubKey(keyPath))
            {
                key.SetValue(null, 1);
                key.SetValue("Description", "FrameCAD - CAD Collaboration for FRC 2129");
                key.SetValue("Title", "FrameCAD");
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

            CreateTaskPane();
            _taskPaneControl?.StartHealthPolling();

            OnActiveDocChange();

            return true;
        }

        public bool DisconnectFromSW()
        {
            _swEvents.ActiveDocChangeNotify -= OnActiveDocChange;
            UnhookMassNotify();

            _taskPaneControl?.StopHealthPolling();
            _taskPaneHost?.ReleaseHandle();
            _taskPaneView?.DeleteView();
            _taskPaneControl?.Dispose();

            _swApp = null;
            _swEvents = null;
            _taskPaneHost = null;
            return true;
        }

        /// <summary>
        /// Detach any FileSavePostNotify handler we previously attached.
        /// Safe to call when no hook is active.
        /// </summary>
        private void UnhookMassNotify()
        {
            if (_massHookPart != null && _massHookHandler != null)
            {
                try { _massHookPart.FileSavePostNotify -= _massHookHandler; } catch { /* doc may already be closed */ }
            }
            _massHookPart = null;
            _massHookHandler = null;
        }

        /// <summary>
        /// Hook FileSavePostNotify on the currently-active PartDoc so that
        /// every save automatically pushes the part's mass to FrameCAD's
        /// metadata. Assemblies and drawings are skipped (only parts have a
        /// single mass property). Called from OnActiveDocChange whenever
        /// the user switches documents.
        /// </summary>
        private void HookMassNotifyOnActiveDoc()
        {
            UnhookMassNotify();
            if (_swApp == null) return;
            try
            {
                var part = _swApp.ActiveDoc as PartDoc;
                if (part == null) return;  // not a part — nothing to mass-track

                // Capture the part in the closure rather than re-reading
                // _swApp.ActiveDoc when the save fires — by then the user
                // may have switched documents and ActiveDoc would point at
                // a different model, making us compute mass for the wrong
                // part.
                var hookedPart = part;
                _massHookHandler = (int saveType, string fileName) =>
                {
                    // Fire-and-forget; mass push must NOT block the SW save.
                    // Errors here would corrupt the save event chain, so
                    // swallow them and let the user retry manually if needed.
                    try { _ = OnPartSavedPushMassAsync(hookedPart, fileName); }
                    catch { /* never throw from a SW event handler */ }
                    return 0;  // event handlers return HRESULT-like int
                };
                part.FileSavePostNotify += _massHookHandler;
                _massHookPart = part;
            }
            catch
            {
                // Some SW versions throw on attaching to closed/invalid docs
                _massHookHandler = null;
                _massHookPart = null;
            }
        }

        /// <summary>
        /// Read the saved part's mass via GetMassProperties2 and POST it
        /// to FrameCAD's REST API. UseSystemUnits=true (SI/kg) so we know
        /// what unit we're converting from, regardless of the document's
        /// configured units. Converts kg→lb and posts in pounds.
        ///
        /// The PartDoc is passed explicitly (captured in the event-hook
        /// closure) rather than read from ActiveDoc — if the user
        /// switches documents between save and our async handler firing,
        /// ActiveDoc would point at the wrong model.
        /// </summary>
        private async System.Threading.Tasks.Task OnPartSavedPushMassAsync(PartDoc hookedPart, string fileName)
        {
            if (string.IsNullOrEmpty(fileName) || hookedPart == null) return;
            try
            {
                var doc = hookedPart as ModelDoc2;
                if (doc == null) return;
                var ext = doc.Extension;
                if (ext == null) return;

                // GetMassProperties2 signature in this interop:
                //   double[] GetMassProperties2(int Accuracy, out int Status, bool UseSystemUnits)
                // The second arg is OUT, not a regular value. UseSystemUnits=true
                // returns props[5] in kg regardless of the document's configured units.
                int massStatus;
                var props = ext.GetMassProperties2(0, out massStatus, true) as double[];
                if (props == null || props.Length < 6) return;
                var kg = props[5];
                if (kg <= 0) return;
                var lb = kg * 2.20462262;

                _taskPaneControl?.NotifyPartMassFromSwAsync(fileName, lb);
            }
            catch
            {
                // Any failure (model not fully loaded, units edge case,
                // network drop) silently aborts — user can set mass
                // manually via the FrameCAD app
            }
        }

        private void CreateTaskPane()
        {
            _taskPaneControl = new TaskPaneControl();
            _taskPaneControl.OnProjectPathChanged = SetSolidWorksWorkingDirectory;
            _taskPaneControl.OnCreateSolidWorksFile = CreateSolidWorksFile;
            _taskPaneControl.OnStageFile = StageFileViaApi;
            _taskPaneControl.OnGetAssemblyChildren = GetAssemblyChildren;
            _taskPaneControl.OnGetActiveDocMaterial = GetActiveDocMaterial;
            _taskPaneControl.OnFillTitleBlock = FillActiveDrawingTitleBlock;

            // Task-pane chrome icon (the small bitmap SolidWorks shows next to
            // "FrameCAD" in the right-side panel tabs). CreateTaskpaneView2
            // expects a 16x18 .bmp; we ship one rendered from the app logo
            // next to the DLL. Falls back to "" so SW shows its default
            // generic icon if the file is missing.
            var dllDir = System.IO.Path.GetDirectoryName(
                System.Reflection.Assembly.GetExecutingAssembly().Location);
            var iconPath = System.IO.Path.Combine(dllDir ?? "", "taskpane-icon.bmp");
            if (!System.IO.File.Exists(iconPath)) iconPath = "";

            _taskPaneView = _swApp.CreateTaskpaneView2(iconPath, "FrameCAD");

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

        /// <summary>
        /// Read the SolidWorks-assigned material for the active part. Returns
        /// empty string if no document is active, the active doc is an
        /// assembly/drawing (only parts have a single material), or no
        /// material is set in the model.
        ///
        /// **Caveat**: only PartDoc.GetMaterialPropertyName2 is documented;
        /// assemblies have per-component materials accessed differently and
        /// are out of scope for this button.
        /// </summary>
        private string GetActiveDocMaterial()
        {
            if (_swApp == null) return "";
            try
            {
                var doc = _swApp.ActiveDoc as ModelDoc2;
                if (doc == null) return "";
                var part = doc as PartDoc;
                if (part == null) return "";  // assembly/drawing — skip
                // Empty configuration name = active configuration
                string database = null;
                var name = part.GetMaterialPropertyName2("", out database);
                return string.IsNullOrWhiteSpace(name) ? "" : name.Trim();
            }
            catch
            {
                // SW API hit a snag — fail silent, button just shows
                // "No material set in SW" via the empty return
                return "";
            }
        }

        /// <summary>
        /// Write the supplied key/value pairs into the active document's
        /// custom properties. Drawing templates whose title blocks link
        /// to these property names ($PRPSHEET:"PartNumber", etc.) will
        /// pick up the values automatically on the next sheet refresh.
        ///
        /// Returns the count of properties successfully written. Properties
        /// with empty values are skipped (we don't want to wipe an
        /// existing title-block value with a blank from FrameCAD).
        ///
        /// **SW API caveat**: Add3 returns 0 on success and a small int
        /// otherwise — we treat any non-throw as success and let the
        /// user verify in the title block. The `swCustomPropertyReplaceValue`
        /// option (= 2) replaces existing values rather than appending.
        /// </summary>
        private int FillActiveDrawingTitleBlock(System.Collections.Generic.IDictionary<string, string> props)
        {
            if (_swApp == null || props == null || props.Count == 0) return 0;
            try
            {
                var doc = _swApp.ActiveDoc as ModelDoc2;
                if (doc == null) return 0;
                var ext = doc.Extension;
                if (ext == null) return 0;
                // Empty config name = document-level (root) custom properties,
                // which is what drawing title blocks read via $PRP:"name".
                var cpm = ext.get_CustomPropertyManager("") as ICustomPropertyManager;
                if (cpm == null) return 0;

                int written = 0;
                foreach (var kv in props)
                {
                    if (string.IsNullOrEmpty(kv.Key) || string.IsNullOrEmpty(kv.Value)) continue;
                    try
                    {
                        cpm.Add3(
                            kv.Key,
                            (int)swCustomInfoType_e.swCustomInfoText,
                            kv.Value,
                            (int)swCustomPropertyAddOption_e.swCustomPropertyReplaceValue);
                        written++;
                    }
                    catch { /* skip and continue with the rest */ }
                }
                // Refresh the rendered title block so the user sees the new
                // custom-property values without manually scrolling/zooming.
                // ForceRebuild3 is on IModelDoc2 (works for drawings and parts)
                // and is far more universally available than DrawingDoc-specific
                // refresh APIs (RebuildTemplate doesn't exist in this interop).
                try { doc.ForceRebuild3(false); }
                catch { /* if rebuild fails, the user can save manually to refresh */ }
                return written;
            }
            catch
            {
                return 0;
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

                // Force IPS (inch / pound / second) on every part FrameCAD
                // creates. FRC teams build in pounds and inches; the team
                // template might be MMGS or MKS, so we override here.
                // SetUserPreferenceIntegerValue on the model affects only
                // this document, not the user's global settings.
                try
                {
                    doc.SetUserPreferenceIntegerValue(
                        (int)swUserPreferenceIntegerValue_e.swUnitSystem,
                        (int)swUnitSystem_e.swUnitSystem_IPS);
                }
                catch { /* template's units win if SW rejects the call */ }

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
            // Tell FrameCAD to git-add the new file so it's actively tracked
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
            // Re-attach the mass-save hook to whichever PartDoc is now active.
            // Done AFTER the task pane updates so the user sees doc info
            // first; mass push happens later on save.
            HookMassNotifyOnActiveDoc();
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
