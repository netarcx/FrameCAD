// Minimal stub definitions for the SolidWorks interop types used by this add-in.
// These are only compiled when the real SolidWorks interop DLLs are not installed
// (e.g., in CI). At runtime the real COM types from SolidWorks are used instead.

using System;
using System.Runtime.InteropServices;

namespace SolidWorks.Interop.sldworks
{
    [ComImport, Guid("83A33D31-27C5-11CE-BFD4-00400513BB57")]
    public interface ISldWorks
    {
        object ActiveDoc { get; }
        ITaskpaneView CreateTaskpaneView3(string iconPath, string title);
        event Func<int> ActiveDocChangeNotify;
    }

    [ComImport, Guid("7A628E09-E920-11D2-BE09-0060089A8B02")]
    public interface ModelDoc2
    {
        string GetPathName();
    }

    [ComImport, Guid("26B1D5B4-2924-4964-8BEA-B365E93C2D3C")]
    public interface ITaskpaneView
    {
        void DisplayWindowFromHandlex64(long handle);
        void DeleteView();
    }
}

namespace SolidWorks.Interop.swpublished
{
    public interface ISwAddin
    {
        bool ConnectToSW(object ThisSW, int Cookie);
        bool DisconnectFromSW();
    }

    [AttributeUsage(AttributeTargets.Class)]
    public class SwAddinAttribute : Attribute
    {
        public string Description { get; set; }
        public string Title { get; set; }
        public bool LoadAtStartup { get; set; }
    }
}
