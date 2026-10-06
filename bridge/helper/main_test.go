package main

import (
	"errors"
	"testing"
	"time"

	bridgegrpc "github.com/ProtonMail/proton-bridge/v3/internal/frontend/grpc"
)

func user(state bridgegrpc.UserState) *bridgegrpc.User {
	return &bridgegrpc.User{State: state}
}

// A list func that reports the account as loading for the first `loading`
// reads, then connected.
func loadingFor(loading int) (func() ([]*bridgegrpc.User, error), *int) {
	reads := 0
	return func() ([]*bridgegrpc.User, error) {
		reads++
		if reads <= loading {
			return []*bridgegrpc.User{user(bridgegrpc.UserState_LOCKED)}, nil
		}
		return []*bridgegrpc.User{user(bridgegrpc.UserState_CONNECTED)}, nil
	}, &reads
}

func TestWaitUsersLoaded(t *testing.T) {
	cases := []struct {
		name       string
		loading    int
		wantReads  int
		wantSleeps int
		wantLoaded bool
	}{
		{"connected at once: one read, no sleep", 0, 1, 0, true},
		{"loading at startup: waits until connected", 3, 4, 3, true},
		{"still loading at the limit: returns the locked list", 1000, 6, 5, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			list, reads := loadingFor(tc.loading)
			sleeps := 0
			users, err := waitUsersLoaded(list, 5*time.Second, time.Second, func(time.Duration) { sleeps++ })
			if err != nil {
				t.Fatal(err)
			}
			if *reads != tc.wantReads || sleeps != tc.wantSleeps {
				t.Fatalf("reads=%d sleeps=%d, want %d and %d", *reads, sleeps, tc.wantReads, tc.wantSleeps)
			}
			if anyLoading(users) == tc.wantLoaded {
				t.Fatalf("anyLoading=%v, want %v", anyLoading(users), !tc.wantLoaded)
			}
		})
	}
}

func TestWaitUsersLoadedStopsOnError(t *testing.T) {
	boom := errors.New("GetUserList failed")
	sleeps := 0
	_, err := waitUsersLoaded(func() ([]*bridgegrpc.User, error) { return nil, boom },
		time.Minute, time.Second, func(time.Duration) { sleeps++ })
	if !errors.Is(err, boom) || sleeps != 0 {
		t.Fatalf("err=%v sleeps=%d, want the list error and no sleep", err, sleeps)
	}
}

func TestNoAccountIsNotLoading(t *testing.T) {
	if anyLoading(nil) {
		t.Fatal("an empty list must not count as loading")
	}
	if anyLoading([]*bridgegrpc.User{user(bridgegrpc.UserState_SIGNED_OUT)}) {
		t.Fatal("a signed-out account is not loading")
	}
}
