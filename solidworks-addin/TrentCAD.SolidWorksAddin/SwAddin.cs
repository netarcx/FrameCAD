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

            CreateTaskPane();
            _taskPaneControl?.StartHealthPolling();

            OnActiveDocChange();

            return true;
        }

        public bool DisconnectFromSW()
        {
            _swEvents.ActiveDocChangeNotify -= OnActiveDocChange;

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

        private bool CreateSolidWorksFile(string absolutePath, bool isAssembly)
        {
            if (_swApp == null || string.IsNullOrEmpty(absolutePath)) return false;
            try
            {
                var templateKey = isAssembly
                    ? (int)swUserPreferenceStringValue_e.swDefaultTemplateAssembly
                    : (int)swUserPreferenceStringValue_e.swDefaultTemplatePart;
                var template = _swApp.GetUserPreferenceStringValue(templateKey);
                if (string.IsNullOrEmpty(template) || !File.Exists(template))
                    return false;

                var doc = _swApp.NewDocument(template, 0, 0, 0) as ModelDoc2;
                if (doc == null) return false;

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
                return saved;
            }
            catch
            {
                return false;
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
