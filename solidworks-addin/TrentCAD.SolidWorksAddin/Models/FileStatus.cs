using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace TrentCAD.SolidWorksAddin.Models
{
    public class FileStatus
    {
        [JsonPropertyName("path")]
        public string Path { get; set; } = "";

        [JsonPropertyName("name")]
        public string Name { get; set; } = "";

        [JsonPropertyName("isDirectory")]
        public bool IsDirectory { get; set; }

        [JsonPropertyName("state")]
        public string State { get; set; } = "synced";

        [JsonPropertyName("lockedBy")]
        public string LockedBy { get; set; }

        [JsonPropertyName("partNumber")]
        public string PartNumber { get; set; }

        [JsonPropertyName("partDescription")]
        public string PartDescription { get; set; }

        [JsonPropertyName("children")]
        public List<FileStatus> Children { get; set; }
    }
}
