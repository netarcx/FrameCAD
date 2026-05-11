using System.Collections.Generic;
using Newtonsoft.Json;

namespace TrentCAD.SolidWorksAddin.Models
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

        [JsonProperty("children")]
        public List<FileStatus> Children { get; set; }
    }
}
