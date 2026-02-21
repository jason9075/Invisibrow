{
  description = "AI Browser Agent development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs {
          inherit system;
          config.allowUnfree = true;
        };
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            bun
            just
            nodejs_20
            chromium
            glib
            nss
            nspr
            atk
            at-spi2-atk
            cups
            dbus
            libdrm
            gtk3
            pango
            cairo
            libX11
            libXcomposite
            libXdamage
            libXext
            libXfixes
            libXrandr
            libgbm
            expat
            alsa-lib
          ];

          shellHook = ''
            export PUPPETEER_EXECUTABLE_PATH="${pkgs.chromium}/bin/chromium"
            export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
            
            # Auto-install dependencies if missing
            if [ ! -d "node_modules" ]; then
              echo "📦 node_modules not found. Installing dependencies..."
              bun install
            fi

            echo "🛡️ AI Browser Agent Dev Shell Loaded"
            echo "Chromium: $(chromium --version)"
            echo "Bun: $(bun --version)"
          '';
        };
      });
}
