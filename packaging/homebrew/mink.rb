class Mink < Formula
  desc "Repository control center"
  homepage "https://github.com/yaroslavlky/mink"
  version "1.0.0"
  license "MIT"
  on_macos do
    url "https://github.com/yaroslavlky/mink/releases/download/v#{version}/mink-darwin-#{Hardware::CPU.arch}.tar.gz"
    sha256 "RELEASE_SHA256"
  end
  on_linux do
    url "https://github.com/yaroslavlky/mink/releases/download/v#{version}/mink-linux-#{Hardware::CPU.arch}.tar.gz"
    sha256 "RELEASE_SHA256"
  end
  def install
    bin.install "mink"
  end
  test do
    assert_match version.to_s, shell_output("#{bin}/mink --version")
  end
end
