import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/** Small .NET Framework launcher for the sync client's Windows pipe transport.
 * It forwards the binary pipe to the same Node relay used on Unix. Keeping the
 * source here lets universal npm tarballs build it without shipping an opaque exe.
 */
const source = String.raw`
using System;
using System.IO;
using System.IO.Pipes;
using System.Diagnostics;
using System.Threading.Tasks;
class Relay {
  static void Pump(Stream input, Stream output) {
    byte[] buffer = new byte[65536];
    int count;
    while ((count = input.Read(buffer, 0, buffer.Length)) > 0) {
      output.Write(buffer, 0, count);
      output.Flush();
    }
  }
  static string Quote(string value) {
    return "\"" + value + "\"";
  }
  static int Main(string[] args) {
    Process child = null;
    try {
      string pipe = null;
      for (int i = 0; i + 1 < args.Length; i++) if (args[i] == "--pipe") pipe = args[i + 1];
      if (pipe == null) throw new Exception("Missing --pipe");
      string[] config = File.ReadAllLines(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "launcher.config"));
      using (var channel = new NamedPipeServerStream(pipe.Substring(9), PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous)) {
        channel.WaitForConnection();
        var info = new ProcessStartInfo(config[0], Quote(config[1]) + " " + Quote(config[2]));
        info.UseShellExecute = false;
        info.CreateNoWindow = true;
        info.RedirectStandardInput = true;
        info.RedirectStandardOutput = true;
        info.EnvironmentVariables["ELECTRON_RUN_AS_NODE"] = "1";
        child = Process.Start(info);
        var input = Task.Factory.StartNew(() => Pump(channel, child.StandardInput.BaseStream));
        var output = Task.Factory.StartNew(() => Pump(child.StandardOutput.BaseStream, channel));
        Task.WaitAny(input, output);
      }
      return 0;
    } catch (Exception error) {
      Console.Error.WriteLine("[graphqlsp] Windows API relay: " + error.Message);
      return 1;
    } finally {
      if (child != null) { try { if (!child.HasExited) child.Kill(); } catch {} child.Dispose(); }
    }
  }
}
`;

export function createWindowsRelay(
  directory: string,
  relayPath: string,
  pipe: string
): string {
  const framework = path.join(
    process.env.WINDIR || 'C:\\Windows',
    'Microsoft.NET'
  );
  const compiler = ['Framework64', 'Framework']
    .map(architecture =>
      path.join(framework, architecture, 'v4.0.30319', 'csc.exe')
    )
    .find(file => fs.existsSync(file));
  if (!compiler)
    throw new Error(
      'GraphQLSP needs .NET Framework 4.x to build its Windows API relay.'
    );
  const sourcePath = path.join(directory, 'launcher.cs');
  const executable = path.join(directory, 'tsserver.exe');
  fs.writeFileSync(sourcePath, source);
  fs.writeFileSync(
    path.join(directory, 'launcher.config'),
    [process.execPath, relayPath, pipe].join('\n')
  );
  execFileSync(
    compiler,
    ['/nologo', '/target:exe', `/out:${executable}`, sourcePath],
    { windowsHide: true, stdio: 'pipe' }
  );
  return executable;
}
