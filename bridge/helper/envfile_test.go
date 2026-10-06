package main

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
)

// The value tests use for a password: it must never show up in an error or
// in the helper's output.
const sentinel = "S3NT1NEL-password-value"

func mustWrite(t *testing.T, path, content string, mode os.FileMode) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), mode); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, mode); err != nil {
		t.Fatal(err)
	}
}

func mustRead(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func inode(t *testing.T, path string) uint64 {
	t.Helper()
	fi, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	st, ok := fi.Sys().(*syscall.Stat_t)
	if !ok {
		t.Fatal("no syscall.Stat_t")
	}
	return uint64(st.Ino)
}

func perm(t *testing.T, path string) os.FileMode {
	t.Helper()
	fi, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	return fi.Mode().Perm()
}

// restoreHooks puts the package-level test hooks back after a test.
func restoreHooks(t *testing.T) {
	t.Helper()
	w, o, a, c := writeAll, openForWrite, afterBackupWrite, chmodFile
	t.Cleanup(func() { writeAll, openForWrite, afterBackupWrite, chmodFile = w, o, a, c })
}

func exitCode(t *testing.T, err error) (int, string) {
	t.Helper()
	var ee *ExitError
	if !errors.As(err, &ee) {
		t.Fatalf("want an *ExitError, got %v", err)
	}
	return ee.Code, ee.Msg
}

func TestUpsertEnv(t *testing.T) {
	cases := []struct {
		name    string
		in      string
		updates []EnvVar
		want    string
	}{
		{
			name:    "replaces in place, keeps comments, appends new names in order",
			in:      "A=1\n# c\nB=2\n",
			updates: []EnvVar{{"B", "x"}, {"C", "y"}},
			want:    "A=1\n# c\nB=x\nC=y\n",
		},
		{
			name:    "removes a later duplicate of a replaced name",
			in:      "B=1\nA=2\nB=3\n",
			updates: []EnvVar{{"B", "x"}},
			want:    "B=x\nA=2\n",
		},
		{
			name:    "adds the missing trailing newline before appending",
			in:      "A=1",
			updates: []EnvVar{{"B", "2"}},
			want:    "A=1\nB=2\n",
		},
		{
			name:    "adds the missing trailing newline after a replacement",
			in:      "A=1",
			updates: []EnvVar{{"A", "x"}},
			want:    "A=x\n",
		},
		{
			name:    "keeps CRLF line endings parseable and consistent",
			in:      "A=1\r\nB=2\r\n",
			updates: []EnvVar{{"B", "x"}, {"C", "y"}},
			want:    "A=1\r\nB=x\r\nC=y\r\n",
		},
		{
			name:    "replaces an export line and a line with spaces around =",
			in:      "export A=1\nB = 2\n",
			updates: []EnvVar{{"A", "x"}, {"B", "y"}},
			want:    "A=x\nB=y\n",
		},
		{
			name:    "does not touch a name that only shares a prefix or is commented out",
			in:      "AB=1\n# A=2\n",
			updates: []EnvVar{{"A", "x"}},
			want:    "AB=1\n# A=2\nA=x\n",
		},
		{
			name:    "writes into an empty file",
			in:      "",
			updates: []EnvVar{{"A", "x"}},
			want:    "A=x\n",
		},
		{
			name:    "the same name twice with the same value is written once",
			in:      "",
			updates: []EnvVar{{"A", "x"}, {"A", "x"}},
			want:    "A=x\n",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := UpsertEnv([]byte(tc.in), tc.updates)
			if err != nil {
				t.Fatalf("UpsertEnv: %v", err)
			}
			if string(got) != tc.want {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
		})
	}
}

func TestUpsertEnvRejectsBadNamesAndValues(t *testing.T) {
	cases := []struct {
		name    string
		updates []EnvVar
		names   string // the error must name this variable
	}{
		{"lowercase name", []EnvVar{{"lower_name", sentinel}}, "lower_name"},
		{"name starting with a digit", []EnvVar{{"1ABC", sentinel}}, "1ABC"},
		{"empty name", []EnvVar{{"", sentinel}}, "password_env"},
		{"newline in value", []EnvVar{{"PW", sentinel + "\nX=1"}}, "PW"},
		{"carriage return in value", []EnvVar{{"PW", sentinel + "\r"}}, "PW"},
		{"NUL in value", []EnvVar{{"PW", sentinel + "\x00"}}, "PW"},
		{"one name, two different values", []EnvVar{{"PW", sentinel}, {"PW", sentinel + "2"}}, "PW"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			in := []byte("KEEP=1\n")
			out, err := UpsertEnv(in, tc.updates)
			if err == nil {
				t.Fatalf("want an error, got %q", out)
			}
			if !strings.Contains(err.Error(), tc.names) {
				t.Fatalf("error %q does not name %q", err, tc.names)
			}
			if strings.Contains(err.Error(), sentinel) {
				t.Fatalf("error %q contains the value", err)
			}
		})
	}
}

func TestWriteInPlace(t *testing.T) {
	dir := t.TempDir()

	t.Run("refuses a directory", func(t *testing.T) {
		if err := WriteInPlace(dir, []byte("x")); err == nil {
			t.Fatal("want an error for a directory")
		}
	})

	t.Run("refuses a missing file and does not create it", func(t *testing.T) {
		missing := filepath.Join(dir, "missing")
		if err := WriteInPlace(missing, []byte("x")); err == nil {
			t.Fatal("want an error for a missing file")
		}
		if _, err := os.Stat(missing); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("missing file was created: %v", err)
		}
	})

	t.Run("truncates and writes into the same inode, mode kept", func(t *testing.T) {
		path := filepath.Join(dir, "env")
		mustWrite(t, path, "A=a much longer previous content than the new one\n", 0o600)
		before := inode(t, path)
		if err := WriteInPlace(path, []byte("A=1\n")); err != nil {
			t.Fatalf("WriteInPlace: %v", err)
		}
		if got := mustRead(t, path); got != "A=1\n" {
			t.Fatalf("content %q", got)
		}
		if inode(t, path) != before {
			t.Fatal("inode changed: the file was replaced, not written in place")
		}
		if p := perm(t, path); p != 0o600 {
			t.Fatalf("mode %o, want 600", p)
		}
	})
}

func TestBackupInPlace(t *testing.T) {
	dir := t.TempDir()

	t.Run("refuses a missing path", func(t *testing.T) {
		missing := filepath.Join(dir, "missing.bak")
		if err := BackupInPlace(missing, []byte("x")); err == nil {
			t.Fatal("want an error for a missing backup file")
		}
		if _, err := os.Stat(missing); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("backup file was created: %v", err)
		}
	})

	t.Run("refuses a directory", func(t *testing.T) {
		if err := BackupInPlace(dir, []byte("x")); err == nil {
			t.Fatal("want an error for a directory")
		}
	})

	t.Run("writes the previous bytes exactly, mode 0600, same inode", func(t *testing.T) {
		path := filepath.Join(dir, "env.bak")
		mustWrite(t, path, "OLD=a much longer stale backup than the new one\n", 0o644)
		before := inode(t, path)
		prev := []byte("A=1\r\n# comment\nPW=" + sentinel + "\n")
		if err := BackupInPlace(path, prev); err != nil {
			t.Fatalf("BackupInPlace: %v", err)
		}
		if got := mustRead(t, path); got != string(prev) {
			t.Fatalf("backup %q, want %q", got, prev)
		}
		if p := perm(t, path); p != 0o600 {
			t.Fatalf("mode %o, want 600", p)
		}
		if inode(t, path) != before {
			t.Fatal("inode changed: the backup was replaced, not written in place")
		}
	})
}

// fixture creates the env file and its backup target in a temp dir.
func fixture(t *testing.T, env string) (envPath, backupPath string) {
	t.Helper()
	dir := t.TempDir()
	envPath = filepath.Join(dir, "env")
	backupPath = filepath.Join(dir, "env.bak")
	mustWrite(t, envPath, env, 0o600)
	mustWrite(t, backupPath, "", 0o600)
	return envPath, backupPath
}

func TestWriteMailboxPasswords(t *testing.T) {
	prev := "KEEP=1\nSIFT_PERSONAL_IMAP_PASSWORD=old\n"

	t.Run("backs up, then upserts in place and names the backup", func(t *testing.T) {
		envPath, backupPath := fixture(t, prev)
		envIno, bakIno := inode(t, envPath), inode(t, backupPath)
		var out bytes.Buffer
		err := WriteMailboxPasswords(envPath, backupPath,
			[]EnvVar{{"SIFT_PERSONAL_IMAP_PASSWORD", sentinel}, {"SIFT_WORK_IMAP_PASSWORD", sentinel + "w"}}, &out)
		if err != nil {
			t.Fatalf("WriteMailboxPasswords: %v", err)
		}
		want := "KEEP=1\nSIFT_PERSONAL_IMAP_PASSWORD=" + sentinel + "\nSIFT_WORK_IMAP_PASSWORD=" + sentinel + "w\n"
		if got := mustRead(t, envPath); got != want {
			t.Fatalf("env %q, want %q", got, want)
		}
		if got := mustRead(t, backupPath); got != prev {
			t.Fatalf("backup %q, want %q", got, prev)
		}
		if inode(t, envPath) != envIno || inode(t, backupPath) != bakIno {
			t.Fatal("an inode changed")
		}
		if !strings.Contains(out.String(), "backup of the previous file: .env.mailboxes.bak (next to .env.mailboxes)") {
			t.Fatalf("output lacks the backup line: %q", out.String())
		}
		if strings.Contains(out.String(), sentinel) {
			t.Fatal("output contains the password")
		}
	})

	t.Run("a 0644 env file (cp under umask 022) ends at 0600, same inode (CR-02)", func(t *testing.T) {
		envPath, backupPath := fixture(t, prev)
		if err := os.Chmod(envPath, 0o644); err != nil {
			t.Fatal(err)
		}
		envIno := inode(t, envPath)
		err := WriteMailboxPasswords(envPath, backupPath,
			[]EnvVar{{"SIFT_PERSONAL_IMAP_PASSWORD", sentinel}}, &bytes.Buffer{})
		if err != nil {
			t.Fatalf("WriteMailboxPasswords: %v", err)
		}
		if p := perm(t, envPath); p != 0o600 {
			t.Fatalf("env mode %o, want 600", p)
		}
		if p := perm(t, backupPath); p != 0o600 {
			t.Fatalf("backup mode %o, want 600", p)
		}
		if inode(t, envPath) != envIno {
			t.Fatal("inode changed: the env file was replaced, not written in place")
		}
		if !strings.Contains(mustRead(t, envPath), "SIFT_PERSONAL_IMAP_PASSWORD="+sentinel+"\n") {
			t.Fatal("the password was not written")
		}
	})

	t.Run("env file mode cannot be set: nothing written, exit 2 with the chmod hint (CR-02)", func(t *testing.T) {
		restoreHooks(t)
		envPath, backupPath := fixture(t, prev)
		realChmod := chmodFile
		chmodFile = func(path string, mode os.FileMode) error {
			if path == envPath {
				return errors.New("injected: operation not permitted")
			}
			return realChmod(path, mode)
		}
		var opened []string
		realOpen := openForWrite
		openForWrite = func(path string) (*os.File, error) {
			opened = append(opened, path)
			return realOpen(path)
		}
		err := WriteMailboxPasswords(envPath, backupPath, []EnvVar{{"PW", sentinel}}, &bytes.Buffer{})
		code, msg := exitCode(t, err)
		if code != 2 || msg != "cannot set .env.mailboxes to mode 0600; nothing was written. On the host: chmod 600 .env.mailboxes" {
			t.Fatalf("code %d, msg %q", code, msg)
		}
		for _, p := range opened {
			if p == envPath {
				t.Fatal("the env file was opened although its mode could not be set")
			}
		}
		if got := mustRead(t, envPath); got != prev {
			t.Fatalf("env changed to %q", got)
		}
	})

	t.Run("env file missing: bridge-init hint, exit 2", func(t *testing.T) {
		_, backupPath := fixture(t, prev)
		err := WriteMailboxPasswords(filepath.Join(t.TempDir(), "absent"), backupPath,
			[]EnvVar{{"PW", sentinel}}, &bytes.Buffer{})
		code, msg := exitCode(t, err)
		if code != 2 || !strings.Contains(msg, "run this in the bridge-init service: docker compose run --rm bridge-init") {
			t.Fatalf("code %d, msg %q", code, msg)
		}
	})

	t.Run("env file is a directory: create-first message, exit 2", func(t *testing.T) {
		_, backupPath := fixture(t, prev)
		err := WriteMailboxPasswords(t.TempDir(), backupPath, []EnvVar{{"PW", sentinel}}, &bytes.Buffer{})
		code, msg := exitCode(t, err)
		if code != 2 || !strings.Contains(msg, "create .env.mailboxes first: cp .env.mailboxes.example .env.mailboxes") {
			t.Fatalf("code %d, msg %q", code, msg)
		}
	})

	for _, tc := range []struct {
		name   string
		backup func(t *testing.T, backupPath string) string
	}{
		{"backup target missing", func(t *testing.T, p string) string {
			if err := os.Remove(p); err != nil {
				t.Fatal(err)
			}
			return p
		}},
		{"backup target is a directory", func(t *testing.T, _ string) string { return t.TempDir() }},
	} {
		t.Run(tc.name+": nothing written, exit 2 with the touch hint", func(t *testing.T) {
			envPath, backupPath := fixture(t, prev)
			backupPath = tc.backup(t, backupPath)
			var out bytes.Buffer
			err := WriteMailboxPasswords(envPath, backupPath, []EnvVar{{"PW", sentinel}}, &out)
			code, msg := exitCode(t, err)
			if code != 2 || !strings.Contains(msg, "touch .env.mailboxes.bak && chmod 600 .env.mailboxes.bak") {
				t.Fatalf("code %d, msg %q", code, msg)
			}
			if got := mustRead(t, envPath); got != prev {
				t.Fatalf("env changed to %q", got)
			}
		})
	}

	t.Run("invalid variable name: nothing written, not even the backup", func(t *testing.T) {
		envPath, backupPath := fixture(t, prev)
		err := WriteMailboxPasswords(envPath, backupPath, []EnvVar{{"lower", sentinel}}, &bytes.Buffer{})
		if err == nil || strings.Contains(err.Error(), sentinel) {
			t.Fatalf("want an error without the value, got %v", err)
		}
		if mustRead(t, envPath) != prev || mustRead(t, backupPath) != "" {
			t.Fatal("a file was written")
		}
	})
}

func TestWriteMailboxPasswordsPartWayFailure(t *testing.T) {
	restoreHooks(t)
	prev := "KEEP=1\nPW=old\n"
	envPath, backupPath := fixture(t, prev)
	real := writeAll
	writeAll = func(f *os.File, b []byte) error {
		if f.Name() != envPath {
			return real(f, b)
		}
		if _, err := f.Write(b[:5]); err != nil {
			return err
		}
		return errors.New("injected: no space left on device")
	}
	err := WriteMailboxPasswords(envPath, backupPath, []EnvVar{{"PW", sentinel}}, &bytes.Buffer{})
	code, msg := exitCode(t, err)
	if code != 2 {
		t.Fatalf("code %d, want 2", code)
	}
	if !strings.Contains(msg, "writing .env.mailboxes failed part-way; the previous content is in .env.mailboxes.bak: cp .env.mailboxes.bak .env.mailboxes") {
		t.Fatalf("message %q does not name the restore command", msg)
	}
	if strings.Contains(msg, sentinel) {
		t.Fatal("message contains the password")
	}
	if got := mustRead(t, backupPath); got != prev {
		t.Fatalf("backup %q, want the previous bytes %q", got, prev)
	}
}

func TestBackupVerifyFailureNeverOpensPrimary(t *testing.T) {
	restoreHooks(t)
	prev := "KEEP=1\nPW=old\n"
	envPath, backupPath := fixture(t, prev)
	afterBackupWrite = func(path string) {
		if err := os.Truncate(path, 3); err != nil {
			t.Fatal(err)
		}
	}
	var opened []string
	realOpen := openForWrite
	openForWrite = func(path string) (*os.File, error) {
		opened = append(opened, path)
		return realOpen(path)
	}
	err := WriteMailboxPasswords(envPath, backupPath, []EnvVar{{"PW", sentinel}}, &bytes.Buffer{})
	code, msg := exitCode(t, err)
	if code != 2 || !strings.Contains(msg, "touch .env.mailboxes.bak && chmod 600 .env.mailboxes.bak") {
		t.Fatalf("code %d, msg %q", code, msg)
	}
	for _, p := range opened {
		if p == envPath {
			t.Fatal("the env file was opened although the backup did not verify")
		}
	}
	if len(opened) == 0 {
		t.Fatal("openForWrite hook was never used")
	}
	if got := mustRead(t, envPath); got != prev {
		t.Fatalf("env changed to %q", got)
	}
}

func TestPlanMailboxPasswords(t *testing.T) {
	accounts := []Account{
		{Addresses: []string{"Owner@Proton.me", "alias@pm.me"}, Password: []byte(sentinel)},
		{Addresses: []string{"signedout@proton.me"}, Password: nil},
	}
	mailboxes := []Mailbox{
		{Slug: "personal", Username: "owner@proton.me", PasswordEnv: "SIFT_PERSONAL_IMAP_PASSWORD"},
		{Slug: "alias", Username: " ALIAS@pm.me ", PasswordEnv: "SIFT_ALIAS_IMAP_PASSWORD"},
		{Slug: "gmail", Username: "someone@gmail.com", PasswordEnv: "SIFT_GMAIL_IMAP_PASSWORD"},
		{Slug: "old", Username: "signedout@proton.me", PasswordEnv: "SIFT_OLD_IMAP_PASSWORD"},
		{Slug: "broken", Username: "owner@proton.me", PasswordEnv: ""},
	}
	plan := PlanMailboxPasswords(mailboxes, accounts)

	wantUpdates := []EnvVar{
		{"SIFT_PERSONAL_IMAP_PASSWORD", sentinel},
		{"SIFT_ALIAS_IMAP_PASSWORD", sentinel},
	}
	if len(plan.Updates) != len(wantUpdates) {
		t.Fatalf("updates %d, want %d", len(plan.Updates), len(wantUpdates))
	}
	for i, u := range wantUpdates {
		if plan.Updates[i] != u {
			t.Fatalf("update %d is %s, want %s", i, plan.Updates[i].Name, u.Name)
		}
	}

	var written []string
	for _, w := range plan.Writes {
		written = append(written, w.Line())
	}
	wantWritten := []string{
		`wrote SIFT_PERSONAL_IMAP_PASSWORD to .env.mailboxes (mailbox "personal")`,
		`wrote SIFT_ALIAS_IMAP_PASSWORD to .env.mailboxes (mailbox "alias")`,
	}
	if strings.Join(written, "|") != strings.Join(wantWritten, "|") {
		t.Fatalf("written lines %q", written)
	}

	skipped := strings.Join(plan.Skipped, "\n")
	for _, want := range []string{
		`mailbox "gmail": no Bridge account has its address; nothing written`,
		`mailbox "old": its Bridge account is signed out`,
		`mailbox "broken": no imap.username or imap.password_env in config.yaml; nothing written`,
	} {
		if !strings.Contains(skipped, want) {
			t.Fatalf("skipped lines %q lack %q", skipped, want)
		}
	}
	all := skipped + strings.Join(written, "\n")
	for _, secret := range []string{sentinel, "owner@proton.me", "Owner@Proton.me", "gmail.com", "signedout"} {
		if strings.Contains(all, secret) {
			t.Fatalf("output lines contain %q", secret)
		}
	}
}
