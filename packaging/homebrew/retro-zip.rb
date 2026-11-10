# Template for Gitguy268/homebrew-tap Formula/retro-zip.rb. Fill in SHA256_SOURCE from the
# tag tarball after tagging. The emulator files are resources with the same pins as
# scripts/fetch-vendor.mjs, so nothing downloads at run time.
class RetroZip < Formula
  desc "Retro game library: emulated games in the browser and games in the terminal"
  homepage "https://github.com/Gitguy268/retro-zip"
  url "https://github.com/Gitguy268/retro-zip/archive/refs/tags/v0.1.0.tar.gz"
  sha256 "SHA256_SOURCE"
  license "GPL-3.0-only"
  head "https://github.com/Gitguy268/retro-zip.git", branch: "main"

  depends_on "sevenzip" => :build
  depends_on "node"

  resource "emulatorjs" do
    url "https://github.com/EmulatorJS/EmulatorJS/releases/download/v4.2.3/4.2.3.7z"
    sha256 "07d451bc06fa3ad04ab30d9b94eb63ac34ad0babee52d60357b002bde8f3850b"
  end

  resource "doom" do
    url "https://github.com/jacobenget/doom.wasm/releases/download/v0.1.0/doom-v0.1.0.wasm"
    sha256 "8edfe49a7583fd975199969302d8e9adcf8e714d0af72bf3e672f991fd810faa"
  end

  # The cores retro-zip uses, as in scripts/fetch-vendor.mjs.
  CORES = %w[fceumm snes9x gambatte mgba genesis_plus_gx smsplus stella2014 fbneo mame2003_plus
             pcsx_rearmed picodrive mednafen_pce handy prosystem gearcoleco mednafen_ngp
             mednafen_wswan].freeze

  def install
    libexec.install "server.mjs", "bin", "lib", "public", "shared", "data", "package.json", "LICENSE", "NOTICE"

    patterns = %w[data/loader.js data/emulator.min.js data/emulator.min.css data/version.json
                  data/compression/* data/localization/en* data/cores/cores.json data/cores/reports/* LICENSE]
    patterns += CORES.flat_map { |c| ["data/cores/#{c}-wasm.data", "data/cores/#{c}-legacy-wasm.data"] }
    system Formula["sevenzip"].opt_bin/"7zz", "x", resource("emulatorjs").cached_download,
           "-o#{libexec}/vendor/emulatorjs", "-y", "-bso0", "-bsp0", *patterns
    resource("doom").stage { (libexec/"vendor/doom").install "doom-v0.1.0.wasm" => "doom.wasm" }

    node = formula_opt_bin("node")/"node"
    (bin/"retro-zip").write <<~SH
      #!/bin/sh
      exec "#{node}" "#{libexec}/bin/retro-zip.mjs" "$@"
    SH
    (bin/"retro-zip-server").write <<~SH
      #!/bin/sh
      # Saves, scores and downloaded games live in ~/.retro-zip (RETRO_ZIP_HOME), outside the keg.
      exec "#{node}" "#{libexec}/server.mjs" "$@"
    SH
  end

  def caveats
    <<~EOS
      Terminal games:  retro-zip
      Browser library: retro-zip-server, then open http://127.0.0.1:8642/
      Saves and scores are kept in ~/.retro-zip.
    EOS
  end

  test do
    assert_match "snake", shell_output("#{bin}/retro-zip list")
    port = free_port
    pid = spawn({ "PORT" => port.to_s, "RETRO_ZIP_HOME" => testpath.to_s }, bin/"retro-zip-server")
    sleep 3
    assert_match "<html", shell_output("curl -s http://127.0.0.1:#{port}/")
  ensure
    Process.kill("TERM", pid) if pid
    Process.wait(pid) if pid
  end
end
