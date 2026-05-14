using System.Collections.Generic;
using Newtonsoft.Json;

namespace FrameCAD.SolidWorksAddin.Models
{
    public class FileStatus
    {
        [JsonProperty("path")]
        public string Path { get; set; } = "";

        [JsonProperty("name")]
        public string Name { get; set; } = "";

        [JsonProperty("isDirectory")]
        public bool IsDirectory { get; set; }

        [JsonProperty("state")]
        public string State { get; set; } = "synced";

        [JsonProperty("lockedBy")]
        public string LockedBy { get; set; }

        [JsonProperty("partNumber")]
        public string PartNumber { get; set; }

        [JsonProperty("partDescription")]
        public string PartDescription { get; set; }

        /// <summary>
        /// True when origin/&lt;branch&gt; has a commit newer than HEAD that
        /// modified this file — i.e. a teammate has uploaded a change to
        /// it that the user hasn't synced yet. Set by /api/file. The
        /// task pane uses this to show a "newer version available"
        /// banner so the user doesn't accidentally edit a stale copy.
        /// </summary>
        [JsonProperty("newerOnRemote")]
        public bool NewerOnRemote { get; set; }

        [JsonProperty("children")]
        public List<FileStatus> Children { get; set; }
    }
}
