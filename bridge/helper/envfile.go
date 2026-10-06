package main

// Writing the bind-mounted .env.mailboxes and its pre-created backup
// .env.mailboxes.bak (D-39, D-79, D-81).
//
// Both host files reach the container as single-file bind mounts, so they are
// only ever written in place: the existing file is opened write-only with
// truncation, written and fsynced. Never a temp file plus rename (a rename
// onto a bind-mounted file fails with EBUSY or detaches it from the host),
// and never the create flag (a missing file is the owner's setup step, not
// something to paper over inside the container). Writing in place keeps the
// inode, the host owner and the mode.

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"regexp"
	"strings"
)

// Fixed texts. The file names are the host names the owner sees.
const (
	msgBridgeInitHint = "run this in the bridge-init service: docker compose run --rm bridge-init"
	msgCreateEnvFirst = "create .env.mailboxes first: cp .env.mailboxes.example .env.mailboxes && chmod 600 .env.mailboxes"
	msgEnvUnreadable  = "cannot read .env.mailboxes; nothing was written"
	msgBackupFailed   = "cannot write the backup .env.mailboxes.bak; nothing was written. " +
		"Create it once on the host: touch .env.mailboxes.bak && chmod 600 .env.mailboxes.bak"
	msgEnvMode = "cannot set .env.mailboxes to mode 0600; nothing was written. " +
		"On the host: chmod 600 .env.mailboxes"
	msgPartWay = "writing .env.mailboxes failed part-way; the previous content is in " +
		".env.mailboxes.bak: cp .env.mailboxes.bak .env.mailboxes"
	lineBackup = "backup of the previous file: .env.mailboxes.bak (next to .env.mailboxes)"
)

// EnvVar is one NAME=value line of the env file.
type EnvVar struct {
	Name  string
	Value string
}

// ExitError carries the helper's exit code and a fixed-text message.
type ExitError struct {
	Code int
	Msg  string
}

func (e *ExitError) Error() string { return e.Msg }

// Test hooks: tests replace them to inject a part-way write failure, to
// change the backup between its write and its verification, to record
// which files were opened for writing, and to refuse a chmod.
var (
	writeAll = func(f *os.File, b []byte) error {
		_, err := f.Write(b)
		return err
	}
	openForWrite = func(path string) (*os.File, error) {
		// Existing files only: truncate, never create.
		return os.OpenFile(path, os.O_WRONLY|os.O_TRUNC, 0)
	}
	afterBackupWrite = func(string) {}
	chmodFile        = os.Chmod
)

var (
	envNamePattern = regexp.MustCompile(`^[A-Z_][A-Z0-9_]*$`)
	// NAME=, NAME = and export NAME=; comments and other lines never match.
	assignmentPattern = regexp.MustCompile(`^[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*=`)
	errNotRegular     = errors.New("not a regular file")
)

// validateUpdates checks names and values and drops exact repeats. Errors
// name the variable, never the value.
func validateUpdates(updates []EnvVar) ([]EnvVar, error) {
	seen := make(map[string]string, len(updates))
	out := make([]EnvVar, 0, len(updates))
	for _, u := range updates {
		if u.Name == "" {
			return nil, errors.New("an imap.password_env name is empty")
		}
		if !envNamePattern.MatchString(u.Name) {
			return nil, fmt.Errorf("%q is not a valid env variable name (A-Z, 0-9 and _, not starting with a digit)", u.Name)
		}
		if strings.ContainsAny(u.Value, "\r\n\x00") {
			return nil, fmt.Errorf("the value for %s contains a line break or NUL", u.Name)
		}
		if prev, ok := seen[u.Name]; ok {
			if prev != u.Value {
				return nil, fmt.Errorf("%s would get two different values: two mailboxes share this password_env", u.Name)
			}
			continue
		}
		seen[u.Name] = u.Value
		out = append(out, u)
	}
	return out, nil
}

// UpsertEnv returns content with NAME=value for every update: the first line
// that assigns NAME is replaced in place, later ones are removed, and names
// not present are appended in update order. Other lines and comments are kept
// byte for byte; the file's line ending (LF or CRLF) is used for new lines, and
// the result always ends with a line ending.
func UpsertEnv(content []byte, updates []EnvVar) ([]byte, error) {
	ups, err := validateUpdates(updates)
	if err != nil {
		return nil, err
	}
	text := string(content)
	eol := "\n"
	if i := strings.IndexByte(text, '\n'); i > 0 && text[i-1] == '\r' {
		eol = "\r\n"
	}
	values := make(map[string]string, len(ups))
	for _, u := range ups {
		values[u.Name] = u.Value
	}
	done := make(map[string]bool, len(ups))

	var b strings.Builder
	for _, line := range strings.SplitAfter(text, "\n") {
		if line == "" {
			continue
		}
		body := strings.TrimRight(line, "\r\n")
		ending := line[len(body):]
		if ending == "" {
			ending = eol
		}
		if m := assignmentPattern.FindStringSubmatch(body); m != nil {
			if value, ok := values[m[1]]; ok {
				if !done[m[1]] {
					done[m[1]] = true
					b.WriteString(m[1] + "=" + value + ending)
				}
				continue
			}
		}
		b.WriteString(body + ending)
	}
	for _, u := range ups {
		if !done[u.Name] {
			b.WriteString(u.Name + "=" + u.Value + eol)
		}
	}
	return []byte(b.String()), nil
}

func requireRegular(path string) error {
	fi, err := os.Stat(path)
	if err != nil {
		return err
	}
	if !fi.Mode().IsRegular() {
		return errNotRegular
	}
	return nil
}

// WriteInPlace replaces the content of the existing regular file at path:
// open write-only with truncation (no create flag), write, fsync. Missing
// files and anything but a regular file are refused. Mode, owner and inode
// stay as they are.
func WriteInPlace(path string, content []byte) error {
	if err := requireRegular(path); err != nil {
		return err
	}
	f, err := openForWrite(path)
	if err != nil {
		return err
	}
	if fi, err := f.Stat(); err != nil || !fi.Mode().IsRegular() {
		_ = f.Close()
		return errNotRegular
	}
	if err := writeAll(f, content); err != nil {
		_ = f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		_ = f.Close()
		return err
	}
	return f.Close()
}

// BackupInPlace writes content into the owner's pre-created backup file:
// refuses a missing or non-regular path, sets mode 0600 before the bytes go
// in, writes in place, then re-reads the file and fails unless it holds
// exactly content. Only after it returns nil may the primary be opened.
func BackupInPlace(path string, content []byte) error {
	if err := requireRegular(path); err != nil {
		return err
	}
	if err := chmodFile(path, 0o600); err != nil {
		return err
	}
	if err := WriteInPlace(path, content); err != nil {
		return err
	}
	afterBackupWrite(path)
	got, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	if !bytes.Equal(got, content) {
		return errors.New("the backup does not hold the expected bytes after writing")
	}
	return nil
}

// WriteMailboxPasswords upserts updates into the env file at envPath after a
// verified backup of its previous content at backupPath. No backup, no write.
// Every refusal is an *ExitError with a fixed message and the helper's exit
// code; none of them contains a value.
func WriteMailboxPasswords(envPath, backupPath string, updates []EnvVar, out io.Writer) error {
	fi, err := os.Stat(envPath)
	switch {
	case errors.Is(err, fs.ErrNotExist):
		return &ExitError{Code: exitEnvFile, Msg: msgBridgeInitHint}
	case err != nil:
		return &ExitError{Code: exitEnvFile, Msg: msgEnvUnreadable}
	case !fi.Mode().IsRegular():
		return &ExitError{Code: exitEnvFile, Msg: msgCreateEnvFirst}
	}
	prev, err := os.ReadFile(envPath)
	if err != nil {
		return &ExitError{Code: exitEnvFile, Msg: msgEnvUnreadable}
	}
	next, err := UpsertEnv(prev, updates)
	if err != nil {
		return &ExitError{Code: exitFailure, Msg: "nothing was written: " + err.Error()}
	}
	if err := BackupInPlace(backupPath, prev); err != nil {
		return &ExitError{Code: exitEnvFile, Msg: msgBackupFailed}
	}
	fmt.Fprintln(out, lineBackup)
	// D-39: the file holds the IMAP password, so it ends at mode 0600 whatever
	// mode the owner's cp left (usually 0644). chmod keeps inode and owner, so
	// the in-place write (D-81) is unaffected; the mode is set before any
	// secret goes in.
	if err := chmodFile(envPath, 0o600); err != nil {
		return &ExitError{Code: exitEnvFile, Msg: msgEnvMode}
	}
	if err := WriteInPlace(envPath, next); err != nil {
		return &ExitError{Code: exitEnvFile, Msg: msgPartWay}
	}
	return nil
}

// Mailbox is the part of a config.yaml mailbox the helper reads.
type Mailbox struct {
	Slug        string
	Username    string
	PasswordEnv string
}

// Account is the part of a Bridge account the helper uses. Password is empty
// unless the account is connected.
type Account struct {
	Addresses []string
	Password  []byte
}

// PlannedWrite is one mailbox whose password goes into the env file.
type PlannedWrite struct {
	Slug string
	Name string
}

// Line is the only output about a written password (D-39).
func (w PlannedWrite) Line() string {
	return fmt.Sprintf("wrote %s to .env.mailboxes (mailbox %q)", w.Name, w.Slug)
}

// MailboxPlan is what configure will write and what it skips.
type MailboxPlan struct {
	Updates []EnvVar
	Writes  []PlannedWrite
	Skipped []string
}

// PlanMailboxPasswords matches each mailbox to the Bridge account that has
// its imap.username among its addresses (case-insensitive). Skip lines name
// the mailbox slug only, never an address.
func PlanMailboxPasswords(mailboxes []Mailbox, accounts []Account) MailboxPlan {
	var plan MailboxPlan
	for _, mb := range mailboxes {
		username := strings.TrimSpace(mb.Username)
		name := strings.TrimSpace(mb.PasswordEnv)
		if username == "" || name == "" {
			plan.Skipped = append(plan.Skipped, fmt.Sprintf(
				"mailbox %q: no imap.username or imap.password_env in config.yaml; nothing written", mb.Slug))
			continue
		}
		account, ok := findAccount(accounts, username)
		if !ok {
			plan.Skipped = append(plan.Skipped, fmt.Sprintf(
				"mailbox %q: no Bridge account has its address; nothing written", mb.Slug))
			continue
		}
		if len(account.Password) == 0 {
			plan.Skipped = append(plan.Skipped, fmt.Sprintf(
				"mailbox %q: its Bridge account is signed out; log in again with "+
					"docker compose run --rm bridge-init; nothing written", mb.Slug))
			continue
		}
		plan.Updates = append(plan.Updates, EnvVar{Name: name, Value: string(account.Password)})
		plan.Writes = append(plan.Writes, PlannedWrite{Slug: mb.Slug, Name: name})
	}
	return plan
}

func findAccount(accounts []Account, username string) (Account, bool) {
	for _, a := range accounts {
		for _, address := range a.Addresses {
			if strings.EqualFold(strings.TrimSpace(address), username) {
				return a, true
			}
		}
	}
	return Account{}, false
}
