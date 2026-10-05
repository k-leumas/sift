// Command sift-helper drives Proton Bridge's gRPC frontend for the Sift
// bridge-init service (bridge/entrypoint.sh, D-39, D-79).
//
// The Docker build copies this directory into Bridge's own source tree as
// cmd/sift-helper, so it can import the generated gRPC client from
// internal/frontend/grpc. A Bridge bump that changes that API therefore fails
// the image build instead of failing at the owner's first login.
//
// Subcommands:
//
//	configure  telemetry and automatic updates off (read back), account
//	           summary, then the IMAP password of each matching mailbox into
//	           the bind-mounted env file
//	repair     trigger Bridge's repair (the live spike's cache rebuild)
//
// Output never contains a password, an address or the gRPC token. Errors name
// the step that failed and the gRPC status code, never a value.
package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"time"

	bridgegrpc "github.com/ProtonMail/proton-bridge/v3/internal/frontend/grpc"
	"github.com/ProtonMail/proton-bridge/v3/internal/service"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/wrapperspb"
	"gopkg.in/yaml.v3"
)

// Exit codes, mirrored by bridge/entrypoint.sh.
const (
	exitOK        = 0
	exitFailure   = 1
	exitEnvFile   = 2
	exitNoAccount = 3
	exitNoMatch   = 4
	exitUsage     = 64
)

const (
	// Bridge writes its gRPC server config (port, cert, token, socket path)
	// into its settings dir, which is $XDG_CONFIG_HOME/protonmail/bridge-v3.
	defaultGRPCConfig = "/data/config/protonmail/bridge-v3/grpcServerConfig.json"
	// Metadata key Bridge's token interceptors check on every call.
	serverTokenKey = "server-token"
	callTimeout    = 30 * time.Second
	repairWait     = 30 * time.Second
)

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

func run(args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		usage(stderr)
		return exitUsage
	}
	switch args[0] {
	case "configure":
		return configure(args[1:], stdout, stderr)
	case "repair":
		return repair(args[1:], stdout, stderr)
	default:
		usage(stderr)
		return exitUsage
	}
}

func usage(w io.Writer) {
	fmt.Fprintln(w, "usage: sift-helper configure --config <config.yaml> --env-file <file> --backup <file>")
	fmt.Fprintln(w, "       sift-helper repair")
}

// fail prints one fixed-text error line.
func fail(w io.Writer, msg string) {
	fmt.Fprintln(w, "sift-helper: "+msg)
}

// bridgeConn is a gRPC client of Bridge's frontend service.
type bridgeConn struct {
	conn   *grpc.ClientConn
	client bridgegrpc.BridgeClient
}

// dial connects the way Bridge's own GUI does: TLS with the server's
// self-generated certificate as the only root, server name 127.0.0.1, and the
// per-run token as metadata on every call.
func dial(configPath string) (*bridgeConn, error) {
	var cfg service.Config
	if err := cfg.Load(configPath); err != nil {
		return nil, errors.New("connect failed: cannot read Bridge's gRPC server config")
	}
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM([]byte(cfg.Cert)) {
		return nil, errors.New("connect failed: Bridge's gRPC server config has no usable certificate")
	}
	target := fmt.Sprintf("127.0.0.1:%d", cfg.Port)
	if cfg.FileSocketPath != "" {
		target = "unix://" + cfg.FileSocketPath
	}
	token := cfg.Token
	creds := credentials.NewTLS(&tls.Config{
		RootCAs:    roots,
		ServerName: "127.0.0.1",
		MinVersion: tls.VersionTLS12,
	})
	conn, err := grpc.NewClient(target,
		grpc.WithTransportCredentials(creds),
		grpc.WithDefaultCallOptions(grpc.WaitForReady(true)),
		grpc.WithUnaryInterceptor(func(
			ctx context.Context, method string, req, reply any,
			cc *grpc.ClientConn, invoker grpc.UnaryInvoker, opts ...grpc.CallOption,
		) error {
			return invoker(metadata.AppendToOutgoingContext(ctx, serverTokenKey, token), method, req, reply, cc, opts...)
		}),
	)
	if err != nil {
		return nil, errors.New("connect failed: cannot create the gRPC client")
	}
	return &bridgeConn{conn: conn, client: bridgegrpc.NewBridgeClient(conn)}, nil
}

// stepError names the step and the gRPC status code only: status messages
// come from Bridge and are not ours to vouch for.
func stepError(step string, err error) error {
	return fmt.Errorf("%s failed (gRPC code %s)", step, status.Code(err))
}

func callCtx() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), callTimeout)
}

// quit asks Bridge to stop its gRPC server (and with it the process), then
// closes the connection. The entrypoint kills Bridge if it does not exit.
func (b *bridgeConn) quit(stderr io.Writer) {
	ctx, cancel := callCtx()
	defer cancel()
	if _, err := b.client.Quit(ctx, &emptypb.Empty{}); err != nil {
		fail(stderr, stepError("Quit", err).Error())
	}
	_ = b.conn.Close()
}

// disablePhoneHome switches telemetry and automatic updates off and reads
// both back, so a setting Bridge ignored fails the run instead of passing
// silently (PROJECT: no telemetry; D-30: updates only by a new pinned image).
func (b *bridgeConn) disablePhoneHome(stdout io.Writer) error {
	ctx, cancel := callCtx()
	defer cancel()

	if _, err := b.client.SetIsTelemetryDisabled(ctx, wrapperspb.Bool(true)); err != nil {
		return stepError("SetIsTelemetryDisabled", err)
	}
	disabled, err := b.client.IsTelemetryDisabled(ctx, &emptypb.Empty{})
	if err != nil {
		return stepError("IsTelemetryDisabled", err)
	}
	if !disabled.GetValue() {
		return errors.New("telemetry is still on after SetIsTelemetryDisabled")
	}
	fmt.Fprintln(stdout, "telemetry: off")

	if _, err := b.client.SetIsAutomaticUpdateOn(ctx, wrapperspb.Bool(false)); err != nil {
		return stepError("SetIsAutomaticUpdateOn", err)
	}
	updates, err := b.client.IsAutomaticUpdateOn(ctx, &emptypb.Empty{})
	if err != nil {
		return stepError("IsAutomaticUpdateOn", err)
	}
	if updates.GetValue() {
		return errors.New("automatic updates are still on after SetIsAutomaticUpdateOn")
	}
	fmt.Fprintln(stdout, "automatic updates: off")
	return nil
}

func (b *bridgeConn) users() ([]*bridgegrpc.User, error) {
	ctx, cancel := callCtx()
	defer cancel()
	list, err := b.client.GetUserList(ctx, &emptypb.Empty{})
	if err != nil {
		return nil, stepError("GetUserList", err)
	}
	return list.GetUsers(), nil
}

func addressMode(u *bridgegrpc.User) string {
	if u.GetSplitMode() {
		return "split"
	}
	return "combined"
}

func userState(u *bridgegrpc.User) string {
	switch u.GetState() {
	case bridgegrpc.UserState_CONNECTED:
		return "connected"
	case bridgegrpc.UserState_LOCKED:
		return "locked"
	default:
		return "signed out"
	}
}

func configure(args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("configure", flag.ContinueOnError)
	fs.SetOutput(stderr)
	configPath := fs.String("config", "/run/sift/config/config.yaml", "Sift config.yaml (read only)")
	envPath := fs.String("env-file", "/run/sift/.env.mailboxes", "env file that receives the IMAP passwords")
	backupPath := fs.String("backup", "/run/sift/.env.mailboxes.bak", "pre-created backup file of the env file")
	grpcConfig := fs.String("grpc-config", defaultGRPCConfig, "Bridge's gRPC server config file")
	if err := fs.Parse(args); err != nil {
		return exitUsage
	}

	b, err := dial(*grpcConfig)
	if err != nil {
		fail(stderr, err.Error())
		return exitFailure
	}
	defer b.quit(stderr)

	if err := b.disablePhoneHome(stdout); err != nil {
		fail(stderr, err.Error())
		return exitFailure
	}

	users, err := b.users()
	if err != nil {
		fail(stderr, err.Error())
		return exitFailure
	}
	// Counts and modes only, never the addresses (D-35, D-43).
	fmt.Fprintf(stdout, "accounts: %d\n", len(users))
	for i, u := range users {
		fmt.Fprintf(stdout, "account %d: addresses: %d, address mode: %s, state: %s\n",
			i+1, len(u.GetAddresses()), addressMode(u), userState(u))
	}
	if len(users) == 0 {
		fail(stderr, "no Bridge account is logged in: run docker compose run --rm bridge-init and type login in the Bridge CLI")
		return exitNoAccount
	}

	mailboxes, err := readMailboxes(*configPath)
	if err != nil {
		fail(stderr, err.Error())
		return exitFailure
	}
	plan := PlanMailboxPasswords(mailboxes, accountsOf(users))
	for _, line := range plan.Skipped {
		fmt.Fprintln(stdout, line)
	}
	if len(plan.Updates) == 0 {
		fail(stderr, "no configured mailbox matches a Bridge address; nothing written")
		return exitNoMatch
	}
	if err := WriteMailboxPasswords(*envPath, *backupPath, plan.Updates, stdout); err != nil {
		var ee *ExitError
		if errors.As(err, &ee) {
			fail(stderr, ee.Msg)
			return ee.Code
		}
		fail(stderr, "write env file failed")
		return exitFailure
	}
	for _, w := range plan.Writes {
		fmt.Fprintln(stdout, w.Line())
	}
	return exitOK
}

// accountsOf keeps what matching needs. Only a connected account's password
// is used: a signed-out or locked account has none to give.
func accountsOf(users []*bridgegrpc.User) []Account {
	accounts := make([]Account, 0, len(users))
	for _, u := range users {
		a := Account{Addresses: u.GetAddresses()}
		if u.GetState() == bridgegrpc.UserState_CONNECTED {
			a.Password = u.GetPassword()
		}
		accounts = append(accounts, a)
	}
	return accounts
}

// siftConfig is the lenient slice of config.yaml the helper needs. Sift's
// own schema validation stays in `sift config check`.
type siftConfig struct {
	Mailboxes []struct {
		Slug string `yaml:"slug"`
		IMAP struct {
			Username    string `yaml:"username"`
			PasswordEnv string `yaml:"password_env"`
		} `yaml:"imap"`
	} `yaml:"mailboxes"`
}

// readMailboxes parses config.yaml. YAML errors can quote values, so they are
// replaced by a fixed message.
func readMailboxes(path string) ([]Mailbox, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, errors.New("cannot read config/config.yaml (mounted at /run/sift/config)")
	}
	var cfg siftConfig
	if err := yaml.Unmarshal(raw, &cfg); err != nil {
		return nil, errors.New("config/config.yaml is not valid YAML or has an unexpected shape; check it with sift config check")
	}
	mailboxes := make([]Mailbox, 0, len(cfg.Mailboxes))
	for _, m := range cfg.Mailboxes {
		mailboxes = append(mailboxes, Mailbox{Slug: m.Slug, Username: m.IMAP.Username, PasswordEnv: m.IMAP.PasswordEnv})
	}
	return mailboxes, nil
}

func repair(args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("repair", flag.ContinueOnError)
	fs.SetOutput(stderr)
	grpcConfig := fs.String("grpc-config", defaultGRPCConfig, "Bridge's gRPC server config file")
	wait := fs.Duration("wait", repairWait, "time to let Bridge work before Quit")
	if err := fs.Parse(args); err != nil {
		return exitUsage
	}

	b, err := dial(*grpcConfig)
	if err != nil {
		fail(stderr, err.Error())
		return exitFailure
	}
	defer b.quit(stderr)

	ctx, cancel := callCtx()
	defer cancel()
	if _, err := b.client.TriggerRepair(ctx, &emptypb.Empty{}); err != nil {
		fail(stderr, stepError("TriggerRepair", err).Error())
		return exitFailure
	}
	fmt.Fprintln(stdout, "repair triggered")
	time.Sleep(*wait)
	return exitOK
}
