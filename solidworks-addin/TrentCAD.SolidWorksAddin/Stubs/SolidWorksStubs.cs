// Minimal stub definitions for the SolidWorks interop types used by this add-in.
// These are only compiled when the real SolidWorks interop DLLs are not installed
// (e.g., in CI). At runtime the real COM types from SolidWorks are used instead.

using System;

namespace SolidWorks.Interop.sldworks
{
    public interface ISldWorks
    {
        object ActiveDoc { get; }
        ITaskpaneView CreateTaskpaneView3(string iconPath, string title);
        event Func<int> ActiveDocChangeNotify;
    }

    public interface ModelDoc2
    {
        string GetPathName();
    }

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
